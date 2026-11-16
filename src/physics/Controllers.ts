import type { RayHit } from './PhysicsWorld';
import { GROUND_QUERY_GROUPS } from './CollisionGroups';
import { add, clamp, clampLength, cross, dot, forward, length, mul, normalize, right, rotate, sub, V, type Vec3 } from './math';
import type { GoatRagdoll } from './GoatRagdoll';

export interface BalanceTuning {
  uprightStiffness: number;
  uprightDamping: number;
  turnStiffness: number;
  turnDamping: number;
  rideHeight: number;
  rideStiffness: number;
  rideDamping: number;
  maxLiftAcceleration: number;
  impactThreshold: number;
  ragdollSeconds: number;
  recoveryPerSecond: number;
}
export class BalanceController {
  readonly tuning: BalanceTuning = {
    uprightStiffness: 31, uprightDamping: 8,
    turnStiffness: 18, turnDamping: 6,
    rideHeight: .92, rideStiffness: 47, rideDamping: 12,
    maxLiftAcceleration: 49, impactThreshold: 1.75,
    ragdollSeconds: 1.35, recoveryPerSecond: .33,
  };
  value = 1;
  isRagdoll = false;
  private remaining = 0;
  private timeSinceRecovery = 0;
  private lastImpactAt = -Infinity;
  constructor(private readonly goat: GoatRagdoll) {}

  handleImpact(impulse: number, otherBodyHandle: number | null): void {
    const g = this.goat;
    const impactSpeed = impulse / g.mass;
    if (impactSpeed <= this.tuning.impactThreshold || g.world.time < .35) return;
    // Gameplay receives physical impulse (N·s); balance uses a mass-normalized speed.
    if (g.world.time - this.lastImpactAt > .12) {
      this.lastImpactAt = g.world.time;
      g.events.emit({ type: 'impact', goatId: g.id, time: g.world.time,
        impulse, otherBodyHandle });
    }
    this.value = clamp(this.value - (impactSpeed - this.tuning.impactThreshold) * .24, 0, 1);
    if (this.value < .22 && !this.isRagdoll) this.enterRagdoll('impact');
  }
  flop(): void { this.value = 0; this.enterRagdoll('flop'); }
  private enterRagdoll(reason: 'flop' | 'impact'): void {
    this.remaining = this.tuning.ragdollSeconds;
    if (!this.isRagdoll) {
      this.isRagdoll = true;
      this.goat.setPose('flop');
      this.goat.events.emit({ type: 'ragdollStart', goatId: this.goat.id,
        time: this.goat.world.time, reason });
    }
  }
  update(dt: number): void {
    const g = this.goat;
    if (this.isRagdoll) {
      this.remaining -= dt;
      if (this.remaining <= 0 && length(g.torso.linvel()) < 6) {
        this.isRagdoll = false;
        this.value = Math.max(this.value,.52);
        this.timeSinceRecovery = 0;
        g.events.emit({ type: 'ragdollEnd', goatId: g.id, time: g.world.time });
      }
      return;
    }
    this.timeSinceRecovery += dt;
    this.value = clamp(this.value + this.tuning.recoveryPerSecond*dt,0,1);
    const torso = g.torso;
    const q = torso.rotation();
    const omega = torso.angvel();
    const tilt = cross(rotate(q,V(0,1,0)),V(0,1,0));
    const currentForward = rotate(q,V(0,0,-1));
    const wanted = forward(g.locomotion.heading);
    const yawError = Math.atan2(
      currentForward.x*wanted.z - currentForward.z*wanted.x,
      currentForward.x*wanted.x + currentForward.z*wanted.z,
    );
    const restoring = V(
      tilt.x*this.tuning.uprightStiffness - omega.x*this.tuning.uprightDamping,
      yawError*this.tuning.turnStiffness - omega.y*this.tuning.turnDamping,
      tilt.z*this.tuning.uprightStiffness - omega.z*this.tuning.uprightDamping,
    );
    // Accelerations are clamped. Angular inertia scales as mass * length^2.
    const angularImpulse = mul(clampLength(restoring,30),g.mass*g.size*g.size*.11*dt);
    torso.applyTorqueImpulse(angularImpulse,true);

    const hit = g.locomotion.groundHit;
    if (!hit || g.locomotion.isClinging) return;
    const height = torso.translation().y - hit.point.y;
    if (height > this.tuning.rideHeight*g.size + .65*g.size) return;
    const yError = this.tuning.rideHeight*g.size - height;
    const acceleration = clamp(
      yError*this.tuning.rideStiffness - torso.linvel().y*this.tuning.rideDamping + 9.81,
      -this.tuning.maxLiftAcceleration, this.tuning.maxLiftAcceleration,
    );
    torso.applyImpulse(V(0,acceleration*g.mass*dt,0),true);
  }
}

export interface MovementInput {
  /** Right (+) / left (-), forward (+) / backward (-), each in [-1,1]. */
  x: number;
  z: number;
  cameraYaw: number;
  sprint: boolean;
  /** External gameplay can gate actions without physics owning stamina. */
  canSprint: boolean;
  canClimb: boolean;
}
export interface LocomotionTuning {
  walkSpeed: number;
  sprintSpeed: number;
  groundAcceleration: number;
  airAcceleration: number;
  maxSlopeDegrees: number;
  jumpHeight: number;
  coyoteSeconds: number;
  jumpBufferSeconds: number;
  climbSpeed: number;
  climbReach: number;
  flipAngularSpeed: number;
}
/** Exposed hooks only: consumption and regeneration are gameplay's responsibility. */
export interface StaminaRates {
  sprintPerSecond: number;
  climbPerSecond: number;
  chargePerSecond: number;
  climbJumpCost: number;
}
export class LocomotionController {
  readonly input: MovementInput = {
    x: 0, z: 0, cameraYaw: 0, sprint: false, canSprint: true, canClimb: true,
  };
  readonly tuning: LocomotionTuning = {
    walkSpeed: 4.4, sprintSpeed: 7.6,
    groundAcceleration: 22, airAcceleration: 5,
    maxSlopeDegrees: 53, jumpHeight: 1.75,
    coyoteSeconds: .15, jumpBufferSeconds: .16,
    climbSpeed: 3.25, climbReach: .78,
    flipAngularSpeed: 13,
  };
  readonly staminaRates: StaminaRates = {
    sprintPerSecond: 9, climbPerSecond: 17, chargePerSecond: 13, climbJumpCost: 11,
  };
  heading = 0;
  grounded = false;
  groundHit: RayHit | null = null;
  isClinging = false;
  airborneSeconds = 0;
  private clock = 0;
  private lastGroundAt = -Infinity;
  private jumpBufferUntil = -Infinity;
  private jumpLockUntil = 0;
  private jumpConsumed = false;
  private flipped = false;
  private flipAngle = 0;
  private flightStarted: number | null = null;
  private lastGrounded = false;
  constructor(private readonly goat: GoatRagdoll) {}

  setInput(partial: Partial<MovementInput>): void {
    Object.assign(this.input,partial);
    this.input.x = clamp(this.input.x,-1,1);
    this.input.z = clamp(this.input.z,-1,1);
  }
  /** Call on key down (not every frame); a second aerial press triggers a flip. */
  requestJump(): void {
    if (!this.grounded && this.jumpConsumed && !this.flipped) {
      this.flipped = true;
      const g = this.goat;
      g.torso.applyTorqueImpulse(V(g.mass*g.size*g.size*.095*this.tuning.flipAngularSpeed,0,0),true);
    } else {
      this.jumpBufferUntil = this.clock + this.tuning.jumpBufferSeconds;
    }
  }
  update(dt: number): void {
    this.clock += dt;
    const g = this.goat, torso = g.torso, s = g.size;
    const ground = g.world.raycast(torso.translation(),V(0,-1,0),1.8*s,
      { groups: GROUND_QUERY_GROUPS });
    this.groundHit = ground;
    const walkable = !!ground && ground.normal.y >= Math.cos(this.tuning.maxSlopeDegrees*Math.PI/180);
    this.grounded = !!(walkable && ground && ground.distance <=
      (g.balance.tuning.rideHeight+.16)*s && this.clock >= this.jumpLockUntil);
    if (this.grounded) {
      this.lastGroundAt = this.clock;
      this.jumpConsumed = false;
      this.flipped = false;
      this.flipAngle = 0;
    }
    const movement = add(mul(forward(this.input.cameraYaw),this.input.z),
      mul(right(this.input.cameraYaw),this.input.x));
    const wishLength = Math.min(1,length(movement));
    const wish = wishLength > 0 ? normalize(movement) : V();
    const wall = wishLength > .1 ? g.world.raycast(
      add(torso.translation(),V(0,.09*s,0)),wish,this.tuning.climbReach*s,
      { groups: GROUND_QUERY_GROUPS },
    ) : null;
    const wallEligible = !!wall && wall.normal.y < .46 && dot(wish,wall.normal) < -.45;
    const clinging = !g.isRagdoll && this.input.canClimb && !this.grounded && wallEligible;
    if (clinging !== this.isClinging) {
      this.isClinging = clinging;
      if (clinging) {
        g.events.emit({type:'wallClingStart',goatId:g.id,time:g.world.time,normal:{...wall!.normal}});
      } else {
        g.events.emit({type:'wallClingEnd',goatId:g.id,time:g.world.time});
      }
    }
    if (this.grounded !== this.lastGrounded) {
      this.lastGrounded = this.grounded;
      if (this.grounded) {
        const duration = this.flightStarted === null ? 0 : this.clock - this.flightStarted;
        if (this.flightStarted !== null) {
          g.events.emit({type:'airtimeEnd',goatId:g.id,time:g.world.time,duration});
          g.events.emit({type:'landed',goatId:g.id,time:g.world.time,airtime:duration,
            verticalSpeed:Math.abs(torso.linvel().y)});
        }
        this.flightStarted = null;
        this.airborneSeconds = 0;
      } else {
        this.flightStarted = this.clock;
        g.events.emit({type:'airtimeStart',goatId:g.id,time:g.world.time,height:torso.translation().y});
      }
    }
    if (this.flightStarted !== null) this.airborneSeconds = this.clock-this.flightStarted;
    if (g.isRagdoll) return;

    if (this.jumpBufferUntil >= this.clock &&
        (this.grounded || this.clock - this.lastGroundAt <= this.tuning.coyoteSeconds)) {
      const impulseSpeed = Math.sqrt(2*9.81*this.tuning.jumpHeight*s);
      const v = torso.linvel();
      // Impulse for the whole linked body, counteracting any downward velocity.
      torso.applyImpulse(V(0,g.mass*(impulseSpeed-Math.min(0,v.y)),0),true);
      this.jumpBufferUntil = -Infinity;
      this.jumpLockUntil = this.clock + .20;
      this.lastGroundAt = -Infinity;
      this.grounded = false;
      this.jumpConsumed = true;
      this.flightStarted = this.clock;
      g.events.emit({type:'airtimeStart',goatId:g.id,time:g.world.time,height:torso.translation().y});
    }

    if (this.isClinging) {
      const upward = clamp(this.tuning.climbSpeed*Math.sqrt(s)-torso.linvel().y,-.2,.34);
      torso.applyImpulse(V(0,upward*g.mass,0),true);
      g.setPose('climb',g.phase+dt*9);
      return;
    }
    if (this.grounded && wishLength > .08) {
      this.heading = Math.atan2(wish.x,-wish.z);
    }
    const sprinting = this.grounded && this.input.sprint && this.input.canSprint;
    const speedScale = s ** .16;
    const targetSpeed = (sprinting ? this.tuning.sprintSpeed : this.tuning.walkSpeed)*speedScale*wishLength;
    let surfaceWish = wish;
    if (ground && walkable && this.grounded && wishLength > 0) {
      surfaceWish = normalize(sub(wish,mul(ground.normal,dot(wish,ground.normal))));
    }
    const v = torso.linvel();
    const target = mul(surfaceWish,targetSpeed);
    const difference = V(target.x-v.x,0,target.z-v.z);
    const accel = this.grounded ? this.tuning.groundAcceleration : this.tuning.airAcceleration;
    const deltaV = clampLength(difference,accel*dt);
    // Body parts share their load through the joint solver.
    torso.applyImpulse(mul(deltaV,g.mass),true);
    if (this.grounded) {
      g.phase += dt*(sprinting ? 12 : 7.6)*Math.max(.4,wishLength);
      g.setPose(wishLength > .12 ? (sprinting ? 'gallop' : 'walk') : 'stand');
    } else {
      g.setPose('jumpTuck');
    }
  }

  afterStep(dt: number): void {
    if (!this.flipped || this.grounded) return;
    this.flipAngle += Math.abs(this.goat.torso.angvel().x)*dt;
    if (this.flipAngle >= Math.PI*2 && this.flipAngle < Math.PI*2 + 50*dt) {
      this.goat.events.emit({type:'flipped',goatId:this.goat.id,
        time:this.goat.world.time,rotations:1});
    }
  }
}
