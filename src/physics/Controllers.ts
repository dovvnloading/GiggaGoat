import type { RayHit } from './PhysicsWorld';
import { CollisionLayer, GROUND_QUERY_GROUPS } from './CollisionGroups';
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
    // A deliberate airborne flip owns rotation until the turn is complete.
    if (g.locomotion.isFlipping) return;
    const torso = g.torso;
    const q = torso.rotation();
    const omega = torso.angvel();
    const bodyUp = rotate(q, V(0, 1, 0));
    const tilt = cross(bodyUp, V(0, 1, 0));
    const currentForward = rotate(q, V(0, 0, -1));
    const wanted = forward(g.locomotion.heading);
    const yawError = Math.atan2(cross(currentForward, wanted).y, dot(currentForward, wanted));
    // Ground contacts from the driven legs can exert much more pitch torque
    // than the air controller. Keep steering from consuming the tilt budget.
    const supported = g.locomotion.grounded;
    // A loaded tongue needs room to pull the head and torso through a ramp.
    const tethered = g.interactions.isTongueAttached;
    const tiltGain = supported ? (tethered ? 2.5 : 6) : 1;
    const turnGain = supported ? (tethered ? 2 : 5) : 1;
    const pitchRoll = V(
      tilt.x * this.tuning.uprightStiffness * tiltGain - omega.x * this.tuning.uprightDamping * Math.sqrt(tiltGain),
      0,
      tilt.z * this.tuning.uprightStiffness * tiltGain - omega.z * this.tuning.uprightDamping * Math.sqrt(tiltGain),
    );
    const turn = yawError * this.tuning.turnStiffness * turnGain -
      omega.y * this.tuning.turnDamping * Math.sqrt(turnGain);
    const angularAcceleration = supported
      ? add(clampLength(pitchRoll, 180), V(0, clamp(turn, -130, 130), 0))
      : clampLength(V(pitchRoll.x, turn, pitchRoll.z), 30);
    // Angular inertia scales as mass * length^2.
    const angularImpulse = mul(angularAcceleration, g.mass * g.size * g.size * .11 * dt);
    torso.applyTorqueImpulse(angularImpulse,true);

    const hit = g.locomotion.groundHit;
    const velocity = torso.linvel();
    if (!hit || g.locomotion.isClinging || velocity.y > 1.1) return;
    const height = torso.translation().y - hit.point.y;
    if (height > this.tuning.rideHeight*g.size + .65*g.size) return;
    const { normal } = hit;
    const layers = hit.collider.collisionGroups() >>> 16;
    const fixed = !hit.body || hit.body.isFixed();
    const deck = (layers & (CollisionLayer.prop | CollisionLayer['build-piece'])) !== 0;
    const slopeSpeed = normal.y >= g.locomotion.minWalkingNormalY
      ? Math.min(0, -(normal.x * velocity.x + normal.z * velocity.z) / normal.y)
      : 0;
    // Follow a walkable grade through a short loss of contact as the slope rolls away.
    // Require recent support within reach so a jump or ledge fall keeps its momentum.
    const downhillTerrain = (layers & CollisionLayer.terrain) !== 0 &&
      normal.y < .995 && slopeSpeed < -.2 && velocity.y >= -3 &&
      g.locomotion.groundSupportAge <= .18 && height <= (this.tuning.rideHeight + .26) * g.size;
    const downhillSpeed = fixed && (deck || downhillTerrain) ? slopeSpeed : 0;
    const yError = this.tuning.rideHeight*g.size - height + downhillSpeed * dt;
    const relativeSpeed = velocity.y - downhillSpeed;
    const acceleration = clamp(
      yError*this.tuning.rideStiffness - relativeSpeed*this.tuning.rideDamping + 9.81,
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
  /** The host may provide this tick's contact after applying world exclusions. */
  climbContact?: RayHit | null;
  /** A known ramp may already support the front of the goat before its torso reaches it. */
  acceptForwardSupport?: (colliderHandle: number) => boolean;
  /** Nearby protective rail with a horizontal braking normal. */
  safetyRail?: { normal: Vec3; distance: number };
}
export interface LocomotionTuning {
  walkSpeed: number;
  sprintSpeed: number;
  groundAcceleration: number;
  reversalBrakeAcceleration: number;
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
    groundAcceleration: 22, reversalBrakeAcceleration: 26, airAcceleration: 5,
    maxSlopeDegrees: 53, jumpHeight: 1.75,
    coyoteSeconds: .15, jumpBufferSeconds: .16,
    climbSpeed: 3.25, climbReach: .78,
    flipAngularSpeed: 20,
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
  private flipAxis: Vec3 | null = null;
  private flipEndsAt = -Infinity;
  private flipAngle = 0;
  private flipScored = false;
  private flightStarted: number | null = null;
  private clingGrace = 0;
  private clingNormal: Vec3 = V(0,0,1);
  private lastGrounded = false;
  constructor(private readonly goat: GoatRagdoll) {}

  setInput(partial: Partial<MovementInput>): void {
    Object.assign(this.input,partial);
    this.input.x = clamp(this.input.x,-1,1);
    this.input.z = clamp(this.input.z,-1,1);
  }
  get groundSupportAge(): number { return this.clock - this.lastGroundAt; }
  get canCoyoteJump(): boolean {
    return !this.grounded && !this.isClinging && !this.goat.isRagdoll &&
      this.canGroundJumpAt(this.clock + this.goat.world.fixedDt);
  }
  get isFlipping(): boolean { return this.airFlipActive && !this.flipScored; }

  private canGroundJumpAt(time: number): boolean {
    return this.grounded ||
      (!this.jumpConsumed && time - this.lastGroundAt <= this.tuning.coyoteSeconds + 1e-9);
  }

  private get airFlipActive(): boolean {
    return this.flipAxis !== null && this.clock <= this.flipEndsAt &&
      !this.grounded && !this.isClinging && !this.goat.isRagdoll;
  }

  /** Call on key down (not every frame); a second aerial press triggers a flip. */
  requestJump(): void {
    if (!this.grounded && this.jumpConsumed && this.flipAxis === null && !this.goat.isRagdoll) {
      if (!this.hasTimeToFlip()) return;
      this.flipAxis = rotate(this.goat.torso.rotation(), V(1, 0, 0));
      this.flipEndsAt = this.clock + .78;
    } else {
      this.jumpBufferUntil = this.clock + this.tuning.jumpBufferSeconds;
    }
  }

  private hasTimeToFlip(): boolean {
    const g = this.goat;
    const floor = g.world.raycast(g.torso.translation(), V(0, -1, 0), 12 * g.size,
      { groups: GROUND_QUERY_GROUPS });
    if (!floor) return true;
    const drop = Math.max(0, floor.distance - (g.balance.tuning.rideHeight + .16) * g.size);
    const vertical = g.torso.linvel().y;
    const gravity = -g.world.raw.gravity.y;
    // Budget time to accelerate the hinged body and to slow before landing.
    const requiredAirtime = Math.PI * 2 / this.tuning.flipAngularSpeed + .16;
    if (gravity <= 0) return vertical >= 0 || drop / -vertical > requiredAirtime;
    const airtime = (vertical + Math.sqrt(vertical * vertical + 2 * gravity * drop)) / gravity;
    return airtime > requiredAirtime;
  }

  private driveAirFlip(dt: number): void {
    const axis = this.flipAxis;
    if (!axis || !this.airFlipActive) return;
    const g = this.goat;
    const remaining = Math.PI * 2 - this.flipAngle;
    const angularSpeed = dot(g.torso.angvel(), axis);
    const scale = g.mass * g.size * g.size;
    if (this.flipScored) {
      // Brake the completed rotation while the balance controller brings the
      // goat upright. The other six bodies still carry angular momentum.
      const targetSpeed = clamp(remaining * 36, -9, 3);
      const correction = clamp((targetSpeed - angularSpeed) * 42, -360, 360);
      g.torso.applyTorqueImpulse(mul(axis, scale * .16 * correction * dt), true);
      return;
    }
    const speed = Math.min(this.tuning.flipAngularSpeed, Math.max(6, remaining * 14));
    const correction = clamp((speed - angularSpeed) * 30, -225, 225);
    g.torso.applyTorqueImpulse(mul(axis, scale * .12 * correction * dt), true);
  }

  get minWalkingNormalY(): number {
    return Math.cos(this.tuning.maxSlopeDegrees * Math.PI / 180);
  }

  /** Classify the same actual contact for ability gating and for the motor. */
  findClimbSurface(movement: Vec3): RayHit | null {
    if (Math.hypot(movement.x, movement.z) <= .1) return null;
    const wish = normalize(V(movement.x, 0, movement.z));
    const g = this.goat;
    const torso = g.torso.translation();
    const query = { groups: GROUND_QUERY_GROUPS };
    const canClimb = (hit: RayHit | null): hit is RayHit =>
      hit !== null && hit.normal.y < this.minWalkingNormalY && dot(wish, hit.normal) < -.45;
    const shoulder = g.world.raycast(add(torso, V(0, .09 * g.size, 0)), wish,
      this.tuning.climbReach * g.size, query);
    if (canClimb(shoulder)) return shoulder;

    // The leading head can already touch a slope even when the chest ray
    // still falls short. Sweep the actual head collider over a short reach.
    const head = g.head;
    const position = head.translation();
    if (dot(sub(position, torso), wish) <= 0) return null;
    const headCollider = head.collider(0);
    const close = g.world.shapeCast(position, head.rotation(), wish, headCollider.shape,
      .14 * g.size, query);
    if (!canClimb(close) || close.body?.isDynamic()) return null;
    // A swept sphere can contact a low edge or end cap. Require the same
    // steep face ahead of the forehead, within the sphere's contact reach.
    const aboveHead = .10 * g.size;
    const faceReach = (headCollider.radius() + Math.max(0, close.normal.y) * aboveHead + .035 * g.size) /
      -dot(wish, close.normal);
    const face = g.world.raycast(add(position, V(0, aboveHead, 0)), wish,
      close.distance + faceReach, query);
    return canClimb(face) && face.collider.handle === close.collider.handle ? face : null;
  }

  findSafetyRail(wish: Vec3, rails: ReadonlySet<number>): MovementInput['safetyRail'] {
    const { torso, head, world, size } = this.goat;
    const velocity = torso.linvel();
    const approach = Math.hypot(velocity.x, velocity.z) > 1.5
      ? normalize(V(velocity.x, 0, velocity.z)) : normalize(wish);
    if (length(approach) === 0) return;
    const leading = dot(sub(head.translation(), torso.translation()), approach) > 0 ? head : torso;
    const hit = world.shapeCast(leading.translation(), leading.rotation(), approach,
      leading.collider(0).shape, .7 * size, { predicate: collider => rails.has(collider.handle) });
    if (!hit || Math.abs(hit.normal.y) > .65) return;
    const normal = normalize(V(hit.normal.x, 0, hit.normal.z));
    if (dot(approach, normal) < -.12) return { normal, distance: hit.distance };
  }

  update(dt: number): void {
    this.clock += dt;
    const g = this.goat, torso = g.torso, s = g.size;
    const position = torso.translation();
    const rideHeight = g.balance.tuning.rideHeight * s;
    const groundedDistance = rideHeight + .16 * s;
    const minGroundY = this.minWalkingNormalY;
    let movement = add(mul(forward(this.input.cameraYaw),this.input.z),
      mul(right(this.input.cameraYaw),this.input.x));
    const rail = this.input.safetyRail;
    if (rail && this.grounded && !g.isRagdoll) {
      // Dissipate inward speed before the fixed solver pushes all seven
      // linked bodies back. Outward, tangential and vertical motion are free.
      const { normal, distance } = rail;
      const maxInward = Math.max(0, (distance - .035) * 6.5);
      for (const body of g.bodies) {
        const velocity = body.linvel();
        const excess = -dot(velocity, normal) - maxInward;
        if (excess > 0) body.setLinvel(add(velocity, mul(normal, excess)), true);
      }
      const motorSpeed = this.input.sprint ? this.tuning.sprintSpeed : this.tuning.walkSpeed;
      const excess = -dot(movement, normal) - maxInward / motorSpeed;
      if (excess > 0) movement = add(movement, mul(normal, excess));
    }
    const wishLength = Math.min(1,length(movement));
    const wish = wishLength > 0 ? normalize(movement) : V();
    let ground = g.world.raycast(position,V(0,-1,0),1.8*s,
      { groups: GROUND_QUERY_GROUPS });
    const acceptsRamp = this.input.acceptForwardSupport;
    if (acceptsRamp && ground && ground.distance > groundedDistance &&
        ground.distance <= rideHeight + .4 * s && wishLength > .1 && this.clock >= this.jumpLockUntil) {
      const ahead = add(position, mul(wish, .6 * s));
      // On a marked courier ramp, the held parcel can cover the next hoof's
      // support ray. Its body still takes part in the actual collision solver.
      const support = g.world.raycast(ahead, V(0,-1,0), groundedDistance, {
        groups: GROUND_QUERY_GROUPS, excludeBody: g.interactions.tongueBody ?? undefined,
      });
      if (support && support.normal.y >= minGroundY && acceptsRamp(support.collider.handle)) ground = support;
    }
    this.groundHit = ground;
    const walkable = !!ground && ground.normal.y >= minGroundY;
    // A small upward gait impulse can still leave the goat at ride height.
    // Apply the usual takeoff cutoff as soon as it has moved clear of that support.
    const takeoffSpeed = ground && ground.distance <= rideHeight + .08 * s ? 1.6 : 1.2;
    this.grounded = !!(walkable && ground && ground.distance <=
      groundedDistance && this.clock >= this.jumpLockUntil && torso.linvel().y < takeoffSpeed);
    if (this.grounded) {
      this.lastGroundAt = this.clock;
      this.jumpConsumed = false;
      this.flipAxis = null;
      this.flipAngle = 0;
      this.flipScored = false;
    }
    const wall = this.input.climbContact === undefined
      ? this.findClimbSurface(movement) : this.input.climbContact;
    if (wall) {
      this.clingGrace = .34;
      this.clingNormal = { ...wall.normal };
    } else {
      this.clingGrace = Math.max(0,this.clingGrace-dt);
    }
    const clinging = !g.isRagdoll && this.input.canClimb && wishLength > .1 &&
      (wall !== null || (this.isClinging && this.clingGrace > 0));
    // Steep-wall intent takes priority over ordinary ground contact, so a goat can
    // initiate a climb with its hooves still planted on flat terrain.
    if (clinging) this.grounded = false;
    if (clinging !== this.isClinging) {
      this.isClinging = clinging;
      if (clinging) {
        g.events.emit({type:'wallClingStart',goatId:g.id,time:g.world.time,normal:{...this.clingNormal}});
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

    if (this.jumpBufferUntil >= this.clock && this.canGroundJumpAt(this.clock)) {
      const impulseSpeed = Math.sqrt(2*9.81*this.tuning.jumpHeight*s);
      const v = torso.linvel();
      // Impulse for the whole linked body, counteracting any downward velocity.
      torso.applyImpulse(V(0,g.mass*(impulseSpeed-Math.min(0,v.y)),0),true);
      this.jumpBufferUntil = -Infinity;
      this.jumpLockUntil = this.clock + .20;
      this.lastGroundAt = -Infinity;
      this.grounded = false;
      this.jumpConsumed = true;
      this.lastGrounded = false;
      const startedFromGround = this.flightStarted === null;
      this.flightStarted = this.clock;
      this.airborneSeconds = 0;
      if (startedFromGround) {
        g.events.emit({type:'airtimeStart',goatId:g.id,time:g.world.time,height:torso.translation().y});
      }
      g.events.emit({type:'jumped',goatId:g.id,time:g.world.time});
    }

    if (this.isClinging) {
      const upward = clamp(this.tuning.climbSpeed*Math.sqrt(s)-torso.linvel().y,-.2,.42);
      // Keep shoulder and hooves in reach when collisions rebound the torso:
      // climbing is a constrained push against a real surface, not a teleport.
      const wallPressure = mul(this.clingNormal,-g.mass*5*dt);
      torso.applyImpulse(add(V(0,upward*g.mass,0),wallPressure),true);
      g.setPose('climb',g.phase+dt*9);
      return;
    }
    this.driveAirFlip(dt);
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
    const velocity = V(v.x,0,v.z);
    const target = V(surfaceWish.x*targetSpeed,0,surfaceWish.z*targetSpeed);
    const accel = this.grounded ? this.tuning.groundAcceleration : this.tuning.airAcceleration;
    let deltaV = clampLength(sub(target,velocity),accel*dt);
    if (this.grounded && wishLength > 0) {
      const direction = normalize(target);
      const speed = length(velocity);
      const opposingSpeed = -dot(velocity,direction);
      if (opposingSpeed > .5 * speed) {
        // Fade in extra braking for counter-steering and scale it by the stick
        // input. Only the ordinary acceleration builds speed in the new direction.
        const opposition = 2 * opposingSpeed / speed - 1;
        const remaining = opposingSpeed - dot(deltaV,direction);
        const brake = clamp(remaining,0,this.tuning.reversalBrakeAcceleration * dt * wishLength * opposition);
        deltaV = add(deltaV,mul(direction,brake));
      }
    }
    // Body parts share their load through the joint solver.
    torso.applyImpulse(mul(deltaV,g.mass),true);
    // A brief gap above shallow ground is common mid-stride. Keep the
    // walking animation through it without granting any grounded abilities.
    const striding = wishLength > .12 && (g.pose === 'walk' || g.pose === 'gallop');
    const strideGap = striding && !this.jumpConsumed && walkable && ground &&
      ground.distance <= groundedDistance + .13 * s &&
      this.clock - this.lastGroundAt <= .22 && Math.abs(v.y) < 1.6;
    if (this.grounded || strideGap) {
      const galloping = sprinting || (strideGap && g.pose === 'gallop' && this.input.sprint);
      g.phase += dt * (galloping ? 12 : 7.6) * Math.max(.4, wishLength);
      g.setPose(wishLength > .12 ? (galloping ? 'gallop' : 'walk') : 'stand');
    } else {
      g.setPose('jumpTuck');
    }
  }

  afterStep(dt: number): void {
    const axis = this.flipAxis;
    if (!axis || !this.airFlipActive) return;
    this.flipAngle += dot(this.goat.torso.angvel(), axis) * dt;
    if (!this.flipScored && this.flipAngle >= Math.PI * 2) {
      this.flipScored = true;
      this.goat.events.emit({type:'flipped',goatId:this.goat.id,
        time:this.goat.world.time,rotations:1});
    }
  }
}
