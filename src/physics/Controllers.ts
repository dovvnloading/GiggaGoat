import type { RayHit } from './PhysicsWorld';
import { CollisionLayer, GROUND_QUERY_GROUPS } from './CollisionGroups';
import { add, clamp, clampLength, cross, dot, forward, length, mul, normalize, right, rotate, sub, V, type Vec3 } from './math';
import type { GoatRagdoll } from './GoatRagdoll';
import { CLIMB_STRIDE, climbStep } from './climb-gait';

const HIP_RECOVERY_HOLD_LIMIT = .65;
const HIP_RECOVERY_HANDOFF_SECONDS = .55;

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
  private hipSupportFloor: number | null = null;
  private hipHoldStarted = 0;
  private hipReturnStarted = -Infinity;
  private lastImpactAt = -Infinity;
  constructor(private readonly goat: GoatRagdoll) {}

  get hipRecoveryGain(): number {
    if (this.hipSupportFloor !== null) return 0;
    const t = clamp((this.goat.world.time - this.hipReturnStarted) / HIP_RECOVERY_HANDOFF_SECONDS, 0, 1);
    return t * t * (3 - 2 * t);
  }

  private fixedFooting(hit: RayHit | null): hit is RayHit {
    return !!hit && hit.normal.y >= this.goat.locomotion.minWalkingNormalY &&
      (!hit.body || hit.body.isFixed());
  }

  private recoverySupportFloor(): number | null {
    const g = this.goat;
    if (g.torso.linvel().y >= 1.6) return null;
    const ground = g.locomotion.groundHit;
    if (this.fixedFooting(ground) && ground.distance <= (this.tuning.rideHeight + .26) * g.size) {
      return ground.point.y;
    }
    // At a ledge the torso ray can miss a platform still bearing a folded leg.
    let floor = -Infinity;
    for (const leg of g.legs) {
      const hit = g.world.raycast(leg.translation(), V(0, -1, 0), .48 * g.size, { groups: GROUND_QUERY_GROUPS });
      if (this.fixedFooting(hit)) floor = Math.max(floor, hit.point.y);
    }
    return Number.isFinite(floor) ? floor : null;
  }

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
  resetForRespawn(): void {
    const wasRagdoll = this.isRagdoll;
    this.value = 1;
    this.isRagdoll = false;
    this.remaining = 0;
    this.hipSupportFloor = null;
    this.hipHoldStarted = 0;
    this.hipReturnStarted = -Infinity;
    this.lastImpactAt = -Infinity;
    if (wasRagdoll) {
      this.goat.events.emit({ type: 'ragdollEnd', goatId: this.goat.id, time: this.goat.world.time });
    }
  }
  private enterRagdoll(reason: 'flop' | 'impact'): void {
    this.remaining = this.tuning.ragdollSeconds;
    if (!this.isRagdoll) {
      this.isRagdoll = true;
      this.hipSupportFloor = null;
      this.hipReturnStarted = -Infinity;
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
        this.hipSupportFloor = this.recoverySupportFloor();
        this.hipHoldStarted = g.world.time;
        g.events.emit({ type: 'ragdollEnd', goatId: g.id, time: g.world.time });
      }
      return;
    }
    this.value = clamp(this.value + this.tuning.recoveryPerSecond*dt,0,1);
    const torso = g.torso;
    const q = torso.rotation();
    const bodyUp = rotate(q, V(0, 1, 0));
    if (this.hipSupportFloor !== null) {
      const ground = g.locomotion.groundHit;
      if (this.fixedFooting(ground) && ground.distance <= (this.tuning.rideHeight + .26) * g.size) {
        this.hipSupportFloor = ground.point.y;
      }
      const height = torso.translation().y - this.hipSupportFloor;
      const upright = bodyUp.y >= .97 && height >= (this.tuning.rideHeight - .02) * g.size;
      if (upright || g.world.time - this.hipHoldStarted >= HIP_RECOVERY_HOLD_LIMIT) {
        this.hipSupportFloor = null;
        this.hipReturnStarted = g.world.time;
      }
    }
    // A deliberate airborne flip owns rotation until the turn is complete.
    if (g.locomotion.isFlipping) return;
    const omega = torso.angvel();
    const wall = g.locomotion.climbSurface;
    if (wall && Math.abs(wall.normal.y) < .22) {
      // Brace the articulated body against the same face as its animated feet.
      // World-upright balance otherwise rolls the neck and legs into the wall.
      const ascent = normalize(sub(V(0, 1, 0), mul(wall.normal, wall.normal.y)));
      const targetUp = add(mul(wall.normal, .98), mul(ascent, .20));
      const targetForward = sub(mul(ascent, .98), mul(wall.normal, .20));
      const turn = add(cross(bodyUp, targetUp), cross(rotate(q, V(0, 0, -1)), targetForward));
      const correction = clampLength(sub(mul(turn, 75), mul(omega, 13)), 120);
      torso.applyTorqueImpulse(mul(correction, g.mass * g.size * g.size * .11 * dt), true);
      return;
    }
    const glideUp = add(V(0, 1, 0), mul(right(g.locomotion.heading), g.locomotion.glideBank));
    const tilt = cross(bodyUp, normalize(glideUp));
    const currentForward = rotate(q, V(0, 0, -1));
    const wanted = forward(g.locomotion.heading);
    const yawError = Math.atan2(cross(currentForward, wanted).y, dot(currentForward, wanted));
    // Ground contacts from the driven legs can exert much more pitch torque
    // than the air controller. Keep steering from consuming the tilt budget.
    const supported = g.locomotion.grounded;
    // A loaded tongue needs room to pull the head and torso through a ramp.
    const tethered = g.interactions.isTongueAttached;
    const tiltGain = supported ? (tethered ? 2.5 : 6) : 1;
    const turnGain = supported ? (tethered ? 2 : 5 * Math.max(1, Math.sqrt(g.movementSpeedScale))) : 1;
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
    if (!hit || g.locomotion.isClinging) return;
    const height = torso.translation().y - hit.point.y;
    // A fast stride can kick the torso upward at a pavement seam. Continue
    // the ride-height damping briefly, while deliberate takeoffs stay free.
    const quickStrideBounce = g.movementSpeedScale > 1 && !g.locomotion.jumpedFromSupport &&
      g.locomotion.groundSupportAge <= .1 && velocity.y < 3 &&
      Math.hypot(velocity.x, velocity.z) > g.locomotion.tuning.walkSpeed * g.movementSpeedScale * .65 &&
      height <= (this.tuning.rideHeight + .28) * g.size && hit.normal.y > .97;
    if (velocity.y > 1.1 && !quickStrideBounce) return;
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
      normal.y < .995 && slopeSpeed < -.2 && velocity.y >= Math.min(-3, slopeSpeed - 1.5) &&
      g.locomotion.groundSupportAge <= .18 && height <= (this.tuning.rideHeight + .4) * g.size;
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
  canGlide?: boolean;
  /** Swimming keeps the water motor's directional response. */
  inWater?: boolean;
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
  climbSurface: RayHit | null = null;
  climbPhase = 0;
  climbStride = V(0, 1, 0);
  isGliding = false;
  glideBank = 0;
  private climbLockUntil = -Infinity;
  private crest: { direction: Vec3; height: number; until: number } | null = null;
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
  private approachSpeed = 0;
  private lastClimbPosition: Vec3 = V();
  private climbStallSeconds = 0;
  private climbApproach = V();
  private lastGrounded = false;
  private lastClimbSupported = false;
  constructor(private readonly goat: GoatRagdoll) {}

  setInput(partial: Partial<MovementInput>): void {
    Object.assign(this.input,partial);
    this.input.x = clamp(this.input.x,-1,1);
    this.input.z = clamp(this.input.z,-1,1);
  }
  get groundSupportAge(): number { return this.clock - this.lastGroundAt; }
  get jumpedFromSupport(): boolean { return this.jumpConsumed && !this.grounded; }
  /** Sample the same stride at the interpolated visual torso position. */
  climbPhaseAt(point: Vec3): number {
    if (!this.climbSurface) return this.climbPhase;
    const travel = dot(sub(point, this.lastClimbPosition), this.climbStride);
    return this.climbPhase + travel / (CLIMB_STRIDE * this.goat.size);
  }
  get canCoyoteJump(): boolean {
    return !this.grounded && !this.isClinging && !this.goat.isRagdoll &&
      this.canGroundJumpAt(this.clock + this.goat.world.fixedDt);
  }
  get landingSoon(): boolean {
    return !this.grounded && !this.isClinging && !this.goat.isRagdoll && !this.hasTimeToFlip();
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
      this.requestFlip();
    } else {
      this.bufferGroundJump();
    }
  }

  /** Buffer a landing jump without interpreting it as a second aerial press. */
  bufferGroundJump(): void {
    if (!this.goat.isRagdoll) this.jumpBufferUntil = this.clock + this.tuning.jumpBufferSeconds;
  }

  requestFlip(): void {
    if (this.grounded || this.isClinging || this.goat.isRagdoll || this.flipAxis || !this.hasTimeToFlip()) return;
    this.flipAxis = rotate(this.goat.torso.rotation(), V(1, 0, 0));
    this.flipEndsAt = this.clock + .78;
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
    if (this.clock < this.climbLockUntil || this.crest) return null;
    const grip = this.isClinging ? this.climbSurface : null;
    if (!grip && Math.hypot(movement.x, movement.z) <= .1) return null;
    const approach = normalize(V(movement.x, 0, movement.z));
    const wish = grip && dot(approach, grip.normal) >= -.55
      ? normalize(V(-grip.normal.x, 0, -grip.normal.z)) : approach;
    const g = this.goat;
    const torso = g.torso.translation();
    const query = { groups: GROUND_QUERY_GROUPS };
    const canClimb = (hit: RayHit | null): hit is RayHit =>
      hit !== null && hit.normal.y > -.45 && hit.normal.y < this.minWalkingNormalY && dot(wish, hit.normal) < -.45;
    const reach = (this.tuning.climbReach + (this.isClinging ? .18 : 0)) * g.size;
    const shoulder = g.world.raycast(add(torso, V(0, .09 * g.size, 0)), wish, reach, query);
    if (canClimb(shoulder)) return shoulder;

    // At a lip the shoulders clear first. Keep pushing only while a lower
    // foothold can still reach the same face.
    if (this.climbSurface) {
      const { normal, collider } = this.climbSurface;
      const hind = g.world.raycast(add(torso, V(0, -.48 * g.size, 0)), wish, reach, query);
      if (canClimb(hind) && hind.collider.handle === collider.handle) return hind;
      if (Math.abs(normal.y) < .22 && dot(wish, normal) < -.45) {
        // At an oblique angle to a column, the forehead can bear against the
        // wall while a ray pointing with the input passes beside it.
        const inward = normalize(V(-normal.x, 0, -normal.z));
        const head = g.head;
        const contactReach = dot(sub(head.translation(), torso), inward) + head.collider(0).radius() + .10 * g.size;
        for (const offset of [.09, -.48]) {
          // Once the body turns upright, the leading hoof can reach farther
          // than the tucked head. Both probes must still hit actual geometry.
          const grip = g.world.raycast(add(torso, V(0, offset * g.size, 0)), inward, Math.max(1.3 * g.size, contactReach), query);
          if (canClimb(grip) && grip.collider.handle === collider.handle) return grip;
        }
      }
      const edge = this.reachableClimbEdge(this.climbSurface, torso);
      if (canClimb(edge)) return edge;
    }

    // On an oblique approach the near shoulder can touch a facet while the
    // centre ray passes alongside it. Verify the swept face at chest height
    // to exclude kerbs and the horizontal top of a prop.
    const chest = add(torso, V(0, .09 * g.size, 0));
    const sweep = g.world.shapeCast(chest, g.torso.rotation(), wish, g.head.collider(0).shape, reach, query);
    if (canClimb(sweep) && Math.abs(sweep.normal.y) < .22 && !sweep.body?.isDynamic()) {
      const inward = normalize(V(-sweep.normal.x, 0, -sweep.normal.z));
      const face = g.world.raycast(chest, inward, reach + g.head.collider(0).radius(), query);
      if (canClimb(face) && face.collider.handle === sweep.collider.handle) return face;
    }

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
    const foreheadReach = close.distance + faceReach;
    const face = g.world.raycast(add(position, V(0, aboveHead, 0)), wish,
      foreheadReach + .30 * g.size, query);
    if (!canClimb(face) || face.collider.handle !== close.collider.handle) return null;
    if (face.distance <= foreheadReach) return face;
    // A raised band on the silo touches the forehead while the parallel
    // wall just above it is recessed. Require both physical faces on the
    // same collider; a lip with air beyond it cannot start a climb.
    const band = g.world.raycast(position, wish, foreheadReach, query);
    return canClimb(band) && band.collider.handle === face.collider.handle &&
      Math.abs(band.normal.y) < .22 && dot(band.normal, face.normal) > .92 ? band : null;
  }

  /** Find the side of an actual rung or narrow rail within the hind hoof's
   * reach when the centreline probes on either side of it pass through air. */
  private reachableClimbEdge(wall: RayHit, torso: Vec3): RayHit | null {
    if (Math.abs(wall.normal.y) >= .22 || !wall.collider.isValid()) return null;
    const { size, world } = this.goat;
    const held = sub(wall.point, torso);
    const query = { groups: GROUND_QUERY_GROUPS };
    // Include a small allowance for the moving hip while the hoof is planted.
    const verticalReach = .9 * size;
    // The supporting hoof stays on its old rung while its partner reaches.
    // Recheck that exact piece of wall and release it once it is out of reach.
    if (Math.abs(held.y) <= verticalReach && length(held) <= 1.3 * size) {
      const skin = .035 * size;
      const anchor = world.raycast(add(wall.point, mul(wall.normal, skin)), mul(wall.normal, -1), 2 * skin, query);
      if (anchor && anchor.collider.handle === wall.collider.handle && dot(anchor.normal, wall.normal) > .9) return anchor;
    }
    const closest = wall.collider.projectPoint(torso, false);
    if (!closest) return null;
    const delta = sub(closest.point, torso);
    const horizontal = Math.hypot(delta.x, delta.z);
    if (horizontal < .001 || length(delta) > 1.3 * size || Math.abs(delta.y) > verticalReach) return null;
    const inward = V(delta.x / horizontal, 0, delta.z / horizontal);
    // Sample just inside a lip to verify its side. A horizontal top or
    // overhang alone cannot supply climbing traction.
    const at = V(torso.x, closest.point.y + Math.sign(delta.y) * .025 * size, torso.z);
    const side = world.raycast(at, inward, horizontal + .08 * size, query);
    return side && Math.abs(side.normal.y) < .22 && side.collider.handle === wall.collider.handle ? side : null;
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
      const motorSpeed = (this.input.sprint && this.input.canSprint ? this.tuning.sprintSpeed : this.tuning.walkSpeed)
        * g.movementSpeedScale;
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
    const verticalSpeed = torso.linvel().y;
    this.grounded = false;
    if (walkable && ground && this.clock >= this.jumpLockUntil && verticalSpeed < takeoffSpeed) {
      this.grounded = ground.distance <= groundedDistance;
      if (!this.grounded && !this.jumpConsumed && this.clock - this.lastGroundAt <= .22 &&
          ground.normal.y < .995 && wishLength > .12) {
        // At higher configured speeds, the ground falls away between fixed
        // steps on a downhill grade. Keep recent support within one short
        // stride, without treating flat ledges or jumps as planted.
        const slopeSpeed = -(ground.normal.x * torso.linvel().x + ground.normal.z * torso.linvel().z) / ground.normal.y;
        const extra = Math.min(.2 * s, Math.max(0, -slopeSpeed) * dt * 3);
        this.grounded = slopeSpeed < -.2 && ground.distance <= groundedDistance + extra;
      }
      if (!this.grounded && wishLength < .08 && Math.abs(verticalSpeed) < .35 &&
          ground.distance <= groundedDistance + .09 * s) {
        // A hoof can still rest on a raised street edge beside the torso ray.
        const floor = ground.point.y;
        this.grounded = g.legs.some(leg => {
          const support = g.world.raycast(leg.translation(), V(0, -1, 0), .48 * s,
            { groups: GROUND_QUERY_GROUPS });
          return support !== null && support.collider.handle !== ground.collider.handle &&
            support.point.y > floor + .03 * s &&
            support.normal.y >= minGroundY && (!support.body || support.body.isFixed());
        });
      }
    }
    if (this.grounded) {
      this.lastGroundAt = this.clock;
      this.jumpConsumed = false;
      this.flipAxis = null;
      this.flipAngle = 0;
      this.flipScored = false;
    }
    const wall = this.input.climbContact === undefined
      ? this.findClimbSurface(movement) : this.input.climbContact;
    const steppingOff = this.grounded && wall && dot(movement, wall.normal) > .20;
    const clinging = !g.isRagdoll && this.input.canClimb && !steppingOff &&
      this.clock >= this.climbLockUntil && (wishLength > .1 || this.isClinging) && wall !== null &&
      !this.startCrest(wall, movement, position);
    this.climbSurface = clinging ? wall : null;
    // Steep-wall intent takes priority over ordinary ground contact, so a goat can
    // initiate a climb with its hooves still planted on flat terrain.
    if (clinging) this.grounded = false;
    if (clinging !== this.isClinging) {
      this.isClinging = clinging;
      if (clinging) {
        this.lastClimbPosition = position;
        this.climbPhase = 0;
        this.climbApproach = wish;
        this.climbStride = normalize(sub(V(0, 1, 0), mul(wall!.normal, wall!.normal.y)));
        this.climbStallSeconds = 0;
        g.events.emit({type:'wallClingStart',goatId:g.id,time:g.world.time,normal:{...wall!.normal}});
      } else {
        g.events.emit({type:'wallClingEnd',goatId:g.id,time:g.world.time});
      }
    }
    if (this.flightStarted !== null) {
      // The support solver can already be lifting the torso at touchdown.
      this.approachSpeed = Math.max(0, -torso.linvel().y, this.approachSpeed * Math.exp(-dt * 9));
    }
    // A wall grip and the controlled crest onto its roof are supported
    // traversal, even though neither qualifies as grounded locomotion.
    const climbSupported = clinging || this.crest !== null;
    const wasSupported = this.lastGrounded || this.lastClimbSupported;
    const supported = this.grounded || climbSupported;
    this.lastGrounded = this.grounded;
    this.lastClimbSupported = climbSupported;
    if (supported !== wasSupported) {
      if (supported) {
        const duration = this.flightStarted === null ? 0 : this.clock - this.flightStarted;
        if (this.flightStarted !== null) {
          g.events.emit({type:'airtimeEnd',goatId:g.id,time:g.world.time,duration});
          if (this.grounded) {
            g.events.emit({type:'landed',goatId:g.id,time:g.world.time,airtime:duration,
              verticalSpeed:Math.abs(torso.linvel().y), approachSpeed:this.approachSpeed});
          }
        }
        this.flightStarted = null;
        this.airborneSeconds = 0;
      } else {
        this.flightStarted = this.clock;
        this.approachSpeed = 0;
        g.events.emit({type:'airtimeStart',goatId:g.id,time:g.world.time,height:torso.translation().y});
      }
    }
    if (this.flightStarted !== null) this.airborneSeconds = this.clock-this.flightStarted;
    const wasGliding = this.isGliding;
    // A queued landing jump takes priority over deploying the glider until
    // it is consumed or expires, so holding jump cannot delay its landing.
    this.isGliding = !!this.input.canGlide && this.jumpBufferUntil < this.clock &&
      !this.grounded && !clinging && !this.crest &&
      !g.isRagdoll && !this.isFlipping && torso.linvel().y <= (wasGliding ? 1.2 : .2);
    if (!this.isGliding) this.glideBank = 0;
    if (g.isRagdoll) { this.crest = null; return; }

    if (!clinging && this.jumpBufferUntil >= this.clock && this.canGroundJumpAt(this.clock)) {
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
      this.lastClimbSupported = false;
      const startedFromGround = this.flightStarted === null;
      this.flightStarted = this.clock;
      this.approachSpeed = 0;
      this.airborneSeconds = 0;
      if (startedFromGround) {
        g.events.emit({type:'airtimeStart',goatId:g.id,time:g.world.time,height:torso.translation().y});
      }
      g.events.emit({type:'jumped',goatId:g.id,time:g.world.time});
    }

    if (this.climbSurface) {
      const normal = this.climbSurface.normal;
      this.heading = Math.atan2(-normal.x, normal.z);
      const ascent = normalize(sub(V(0, 1, 0), mul(normal, normal.y)));
      const sideways = cross(ascent, normal);
      const inward = normalize(V(-normal.x, 0, -normal.z));
      const stick = mul(wish, wishLength);
      // Give an oblique approach a stable uphill lane on curved walls and silo bands.
      // Partial stick travel still feathers both axes outside the forward cone.
      const into = dot(wish, inward);
      const along = dot(stick, sideways);
      const followingApproach = into > .48 && dot(wish, this.climbApproach) > .97;
      const steer = followingApproach ? 0 : 1 - clamp((into - .77) / .13, 0, 1);
      const rise = into > 0 ? Math.min(1, (followingApproach ? wishLength : dot(stick, inward)) * 1.55) : dot(stick, inward);
      const side = along * steer;
      this.climbPhase = this.climbPhaseAt(position);
      if (wishLength > .10) this.climbStride = normalize(add(mul(ascent, rise), mul(sideways, side)));
      this.lastClimbPosition = position;
      const phase = this.climbPhase * 2 * Math.PI;
      const drive = 1 + .16 * Math.cos(2 * phase);
      const target = this.tuning.climbSpeed * Math.sqrt(s) * drive * (rise < 0 ? .72 : 1) * rise / ascent.y;
      const gravity = -dot(g.world.raw.gravity, ascent) * dt;
      const pull = clamp(target - dot(torso.linvel(), ascent) + gravity, -.2, .42);
      const traction = mul(ascent, pull * g.mass);
      // The small Rapier leg boxes take a portion of the supporting load.
      // Keep peak impulses below the hips' holding strength at contact.
      const footShare = pull > 0 ? .12 : 0;
      const sideTarget = this.tuning.climbSpeed * Math.sqrt(s) * .85 * side;
      const sideStep = (side === 0 ? 9 : 13) * dt;
      const lateral = mul(sideways, clamp(sideTarget - dot(torso.linvel(), sideways), -sideStep, sideStep));
      let grip = mul(normal, -5 * dt);
      if (Math.abs(normal.y) < .22) {
        const velocity = torso.linvel();
        const clearance = dot(sub(position, this.climbSurface.point), normal);
        // When a raised seam catches the leading limbs, push the torso out
        // while its feet are braced, then draw it back as the ascent resumes.
        const stalled = rise > .25 && dot(velocity, ascent) < .30 * target;
        this.climbStallSeconds = clamp(this.climbStallSeconds + (stalled ? dt : -2 * dt), 0, .35);
        const stepOut = .30 * clamp((this.climbStallSeconds - .12) / .18, 0, 1);
        const brace = clamp(((.75 + stepOut) * s - clearance) * 80 - dot(velocity, normal) * 13, -19, 19);
        grip = mul(normal, brace * dt);
      }
      torso.applyImpulse(add(mul(traction, 1 - footShare), mul(add(grip, lateral), g.mass)), true);
      if (footShare) {
        const first = climbStep(this.climbPhase, false).lift === 0;
        const second = climbStep(this.climbPhase, true).lift === 0;
        const push = mul(traction, footShare / (2 * (Number(first) + Number(second))));
        if (first) {
          g.getPart('frontLeft').applyImpulse(push, true);
          g.getPart('backRight').applyImpulse(push, true);
        }
        if (second) {
          g.getPart('frontRight').applyImpulse(push, true);
          g.getPart('backLeft').applyImpulse(push, true);
        }
      }
      g.setPose('climb', phase);
      return;
    }
    if (this.crest) {
      const crest = this.crest;
      if (this.clock < crest.until && !this.grounded && dot(movement, crest.direction) > .15) {
        const heightGap = (crest.height - position.y) / s;
        const advance = clamp(1.3 - heightGap * 1.7, .14, 1);
        const target = mul(crest.direction, 3.6 * Math.sqrt(s) * advance);
        target.y = clamp((crest.height - position.y) * 8, -.8, 3.8 * Math.sqrt(s));
        this.driveFlightVelocity(target, 19, dt);
        g.setPose('jumpTuck');
        return;
      }
      this.crest = null;
    }
    if (this.isGliding) {
      this.driveGlider(wish, wishLength, wasGliding, dt);
      g.setPose('jumpTuck');
      return;
    }
    this.driveAirFlip(dt);
    if (this.grounded && wishLength > .08) {
      this.heading = Math.atan2(wish.x,-wish.z);
    }
    const sprinting = this.grounded && this.input.sprint && this.input.canSprint;
    // A dynamic load needs a controlled tow speed so the tether and cargo
    // are not thrown through scenery by the faster small-goat motor.
    const towing = g.interactions.tongueBody?.isDynamic() === true;
    const speedScale = towing ? Math.min(g.movementSpeedScale, .92) : g.movementSpeedScale;
    const targetSpeed = (sprinting ? this.tuning.sprintSpeed : this.tuning.walkSpeed)*speedScale*wishLength;
    let surfaceWish = wish;
    if (ground && walkable && this.grounded && wishLength > 0) {
      surfaceWish = normalize(sub(wish,mul(ground.normal,dot(wish,ground.normal))));
    }
    const v = torso.linvel();
    const velocity = V(v.x,0,v.z);
    // A brief gap above shallow ground is common mid-stride. Keep its
    // established ground-following response without granting grounded abilities.
    const striding = wishLength > .12 && (g.pose === 'walk' || g.pose === 'gallop');
    const strideGap = striding && !this.jumpConsumed && walkable && ground &&
      ground.distance <= groundedDistance + .13 * s &&
      this.clock - this.lastGroundAt <= .22 && Math.abs(v.y) < 1.6;
    // A jump is deliberate immediately; walking off a ledge becomes free
    // flight after the short ground-following interval and a clear ground ray.
    // A freshly spawned goat has no takeoff momentum to preserve yet.
    const momentumAir = !this.grounded && !this.input.inWater &&
      (this.jumpConsumed || (!ground && Number.isFinite(this.lastGroundAt) && this.clock - this.lastGroundAt > .25));
    const target = V(surfaceWish.x*targetSpeed,0,surfaceWish.z*targetSpeed);
    let deltaV = this.grounded
      ? clampLength(sub(target,velocity),this.tuning.groundAcceleration*dt)
      : momentumAir ? V() : clampLength(sub(target,velocity),this.tuning.airAcceleration*dt);
    if (momentumAir && wishLength > 0) {
      // Air input accelerates toward the desired direction; it must not
      // brake an already faster takeoff or brake at all after release.
      const along = dot(velocity, wish), speed = length(velocity);
      const push = clamp(targetSpeed - along, 0, this.tuning.airAcceleration * dt * wishLength);
      if (push > 0) {
        let steered = add(velocity, mul(wish, push));
        // Turning an already-fast goat can redirect momentum, but cannot
        // create extra speed; counter-steering may still slow it down.
        if (speed > targetSpeed && along >= 0) steered = mul(normalize(steered), speed);
        deltaV = sub(steered, velocity);
      }
    }
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
    if (this.grounded || strideGap) {
      const galloping = sprinting || (strideGap && g.pose === 'gallop' && this.input.sprint);
      g.phase += dt * (galloping ? 12 : 7.6) * Math.max(.4, wishLength);
      g.setPose(wishLength > .12 ? (galloping ? 'gallop' : 'walk') : 'stand');
    } else {
      g.setPose('jumpTuck');
    }
  }

  leaveTraversal(): void {
    this.crest = null;
    this.climbLockUntil = -Infinity;
    this.isGliding = false;
    this.glideBank = 0;
    this.climbSurface = null;
    if (this.isClinging) {
      this.isClinging = false;
      this.goat.events.emit({ type: 'wallClingEnd', goatId: this.goat.id, time: this.goat.world.time });
    }
  }

  /** Forget movement history when a rescue creates a new grounded spawn. */
  resetForRespawn(): void {
    this.leaveTraversal();
    this.grounded = false;
    this.groundHit = null;
    this.lastGrounded = false;
    this.lastClimbSupported = false;
    this.lastGroundAt = -Infinity;
    this.jumpBufferUntil = -Infinity;
    this.jumpLockUntil = 0;
    this.jumpConsumed = false;
    this.flipAxis = null;
    this.flipEndsAt = -Infinity;
    this.flipAngle = 0;
    this.flipScored = false;
    this.flightStarted = null;
    this.airborneSeconds = 0;
    this.approachSpeed = 0;
    this.climbStallSeconds = 0;
    this.climbPhase = 0;
  }

  kickOffWall(): void {
    const wall = this.input.climbContact ?? this.climbSurface;
    if (!wall) return;
    const outward = normalize(V(wall.normal.x, 0, wall.normal.z));
    const scale = Math.sqrt(this.goat.size);
    const v = this.goat.torso.linvel();
    const launch = mul(outward, Math.max(0, 5.2 * scale - dot(v, outward)));
    launch.y = Math.max(0, 4.6 * scale - v.y);
    for (const body of this.goat.bodies) body.applyImpulse(mul(launch, body.mass()), true);
    this.lastGroundAt = this.jumpBufferUntil = -Infinity;
    this.jumpConsumed = true;
    this.jumpLockUntil = this.climbLockUntil = this.clock + .32;
    this.goat.events.emit({ type: 'jumped', goatId: this.goat.id, time: this.goat.world.time });
  }

  private startCrest(wall: RayHit, movement: Vec3, position: Vec3): boolean {
    if (!this.isClinging || this.grounded || wall.body?.isDynamic() || Math.abs(wall.normal.y) > .25 ||
        -dot(movement, wall.normal) < .30) return false;
    const g = this.goat, s = g.size;
    const inward = normalize(V(-wall.normal.x, 0, -wall.normal.z));
    const reach = dot(sub(wall.point, position), inward) + .68 * s;
    const query = { groups: GROUND_QUERY_GROUPS };
    const overhead = add(position, V(0, .48 * s, 0));
    if (g.world.raycast(overhead, inward, reach, query)) return false;
    const top = g.world.raycast(add(overhead, mul(inward, reach)), V(0, -1, 0), 1.1 * s, query);
    if (!top || top.body?.isDynamic() || top.normal.y < this.minWalkingNormalY ||
        wall.point.y > top.point.y + .1 * s || position.y < top.point.y + .27 * s) return false;
    // A raised band or ladder rung also has an upward-facing triangle.
    // Both hindquarters must fit behind the lip on a walkable landing.
    const across = V(-inward.z, 0, inward.x);
    for (const side of [-.34, .34]) {
      const back = add(top.point, add(mul(inward, .6 * s), mul(across, side * s)));
      const support = g.world.raycast(add(back, V(0, .28 * s, 0)), V(0, -1, 0), .58 * s, query);
      if (!support || support.body?.isDynamic() || support.normal.y < this.minWalkingNormalY) return false;
    }
    const height = top.point.y + g.balance.tuning.rideHeight * s;
    const shoulder = V(position.x, height, position.z);
    if (g.world.shapeCast(shoulder, g.head.rotation(), inward, g.head.collider(0).shape, reach + .45 * s, query) ||
        g.world.raycast(add(top.point, V(0, .04 * s, 0)), V(0, 1, 0), 1.45 * s, query)) return false;
    this.crest = { direction: inward, height, until: this.clock + .72 * Math.sqrt(s) };
    return true;
  }

  private driveFlightVelocity(target: Vec3, acceleration: number, dt: number): void {
    const g = this.goat;
    const velocity = g.torso.linvel();
    const planar = clampLength(V(target.x - velocity.x, 0, target.z - velocity.z), acceleration * dt);
    planar.y = clamp(target.y - velocity.y - g.world.raw.gravity.y * dt, -12 * dt, 25 * dt);
    for (const body of g.bodies) body.applyImpulse(mul(planar, body.mass()), true);
  }

  private driveGlider(wish: Vec3, strength: number, deployed: boolean, dt: number): void {
    const g = this.goat, v = g.torso.linvel();
    if (!deployed && Math.hypot(v.x, v.z) > 1.5) this.heading = Math.atan2(v.x, -v.z);
    let turn = 0;
    if (strength > .10) {
      const delta = Math.atan2(wish.x, -wish.z) - this.heading;
      turn = clamp(Math.atan2(Math.sin(delta), Math.cos(delta)) * 2.8, -1.95, 1.95) * strength;
      this.heading += turn * dt;
    }
    this.glideBank += (turn * .19 - this.glideBank) * -Math.expm1(-5 * dt);
    const target = mul(forward(this.heading), 7.2 * g.size ** .16);
    target.y = -1.95 - .65 * Math.abs(this.glideBank);
    this.driveFlightVelocity(target, 14, dt);
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
