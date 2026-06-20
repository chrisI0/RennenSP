import * as THREE from 'three';

/**
 * SimpleRaycastVehicle
 *
 * Lightweight rigid-body vehicle physics using raycast suspension against the
 * Y = 0 ground plane.  Designed to integrate directly with MouseSimInputManager.
 *
 * Features:
 *   • 4-wheel independent Hooke's Law suspension springs
 *   • Rear-wheel drive with progressive throttle
 *   • All-wheel braking (proportional)
 *   • Lateral tire grip via slip-proportional cornering force, friction-capped
 *   • Rolling resistance + quadratic aero drag
 *   • Zero per-frame heap allocations (all scratch vectors pre-allocated)
 *   • Wireframe debug chassis mesh with wheel markers
 *
 * Usage:
 *   const vehicle = new SimpleRaycastVehicle(scene);
 *   // in render loop:
 *   vehicle.update(dt, inputManager);
 */
export class SimpleRaycastVehicle {

  // ================================================================
  //  CONSTRUCTOR
  // ================================================================

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} [spawnPosition]  Initial world position (default: 0, 2, 0)
   */
  constructor(scene, spawnPosition) {
    this._scene = scene;

    // ── Chassis dimensions ────────────────────────────────
    this.chassisWidth  = 2.0;
    this.chassisHeight = 1.0;
    this.chassisLength = 4.5;

    // ── Rigid body state ──────────────────────────────────
    this.mass = 1400; // kg

    this.position        = new THREE.Vector3(0, 2, 0);
    this.velocity        = new THREE.Vector3();
    this.acceleration    = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.orientation     = new THREE.Quaternion();

    if (spawnPosition) this.position.copy(spawnPosition);

    // Diagonal moment of inertia (box approximation)
    const m = this.mass;
    const w = this.chassisWidth;
    const h = this.chassisHeight;
    const l = this.chassisLength;
    this._inertia = new THREE.Vector3(
      (m / 12) * (h * h + l * l),   // Ixx  – pitch
      (m / 12) * (w * w + l * l),   // Iyy  – yaw
      (m / 12) * (w * w + h * h)    // Izz  – roll
    );

    // ── Suspension parameters ─────────────────────────────
    this.suspensionRestLength = 0.6;   // m
    this.springStiffness      = 28000; // N/m
    this.dampingCoefficient   = 4500;  // Ns/m

    // ── Engine & braking ──────────────────────────────────
    this.engineForce = 7000;  // N  (total, split across driven wheels)
    this.brakeForce  = 15000; // N  (total, split across all wheels)
    this.maxSpeed    = 65;    // m/s  (≈ 234 km/h)

    // ── Sequential Powertrain ─────────────────────────────
    this.gearRatios = {
      '-1': 2.8,   // Reverse
      '0': 0.0,    // Neutral
      '1': 3.0,    // 1st Gear
      '2': 2.2,    // 2nd Gear
      '3': 1.7,    // 3rd Gear
      '4': 1.4,    // 4th Gear
      '5': 1.15,   // 5th Gear
      '6': 0.98,   // 6th Gear
      '7': 0.85,   // 7th Gear
    };
    this.currentGear = 1; // Default to 1st gear
    this.rpm = 1200;      // Start at idle RPM
    this.idleRPM = 1200;
    this.maxRPM = 15000;
    this.shiftUpRPM = 14200;
    this.shiftDownRPM = 4500;

    // ── Steering & tires ──────────────────────────────────
    this.maxSteerAngle      = Math.PI / 6;  // 30°
    this.corneringStiffness = 18000;        // N per (m/s lateral) per tire
    this.rollingResistance  = 250;          // N constant
    this.aeroDragCoeff      = 0.45;         // combined 0.5·ρ·Cd·A
    this.angularDamping     = 2.0;          // per-second damping factor

    // ── Wheel layout (local space from chassis center) ────
    const hw = w * 0.5;
    const hh = h * 0.5;
    const hl = l * 0.5;

    this._localWheelPos = [
      new THREE.Vector3(-hw, -hh, -hl),  // 0 : Front-Left
      new THREE.Vector3( hw, -hh, -hl),  // 1 : Front-Right
      new THREE.Vector3(-hw, -hh,  hl),  // 2 : Rear-Left
      new THREE.Vector3( hw, -hh,  hl),  // 3 : Rear-Right
    ];

    // Per-wheel readable state
    this.wheelCompression = new Float32Array(4);
    this.wheelGrounded    = [false, false, false, false];

    // ── Pre-allocated scratch memory ──────────────────────
    // Force / torque accumulators
    this._totalForce  = new THREE.Vector3();
    this._totalTorque = new THREE.Vector3();

    // Chassis basis (set every frame)
    this._forward = new THREE.Vector3();
    this._right   = new THREE.Vector3();
    this._up      = new THREE.Vector3();

    // World-space wheel positions
    this._worldWP = [
      new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(),
    ];

    // 8 general-purpose scratch vectors (never 'new'd in update)
    this._v = [];
    for (let i = 0; i < 8; i++) this._v.push(new THREE.Vector3());

    // Scratch quaternion
    this._q0 = new THREE.Quaternion();

    // ── Build Three.js mesh ───────────────────────────────
    this._buildMesh();
  }

  // ================================================================
  //  MESH CONSTRUCTION
  // ================================================================

  _buildMesh() {
    const { chassisWidth: w, chassisHeight: h, chassisLength: l } = this;
    const boxGeo = new THREE.BoxGeometry(w, h, l);

    // Translucent fill
    const fillMat = new THREE.MeshStandardMaterial({
      color:       0x2255cc,
      transparent: true,
      opacity:     0.12,
      roughness:   0.4,
      metalness:   0.6,
      depthWrite:  false,
    });

    this.mesh = new THREE.Mesh(boxGeo, fillMat);
    this.mesh.castShadow    = true;
    this.mesh.receiveShadow = true;

    // Wireframe edges
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x4499ff });
    this._wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    this.mesh.add(this._wireframe);

    // Wheel debug markers (green = grounded, red = airborne)
    const markerGeo = new THREE.SphereGeometry(0.1, 6, 4);
    this._wheelMarkers = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x22ff44 });
      const marker = new THREE.Mesh(markerGeo, mat);
      marker.position.copy(this._localWheelPos[i]);
      this.mesh.add(marker);
      this._wheelMarkers.push(marker);
    }

    // Forward-direction indicator (orange cone)
    const arrowGeo = new THREE.ConeGeometry(0.08, 0.3, 4);
    arrowGeo.rotateX(Math.PI / 2); // tip points toward -Z (forward)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(0, 0, -(l * 0.5 + 0.2));
    this.mesh.add(arrow);

    this._scene.add(this.mesh);

    // Sync initial pose
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.orientation);
  }

  // ================================================================
  //  CORE PHYSICS UPDATE
  // ================================================================

  /**
   * Advance the vehicle simulation by one time step.
   *
   * @param {number} dt       Delta time in seconds
   * @param {object} inputs   MouseSimInputManager instance
   *   inputs.steering  –  -1 (left) … +1 (right)
   *   inputs.throttle  –   0 … 1
   *   inputs.brake     –   0 … 1
   */
  update(dt, inputs) {
    // Stability guard
    if (dt > 0.02) dt = 0.02;
    if (dt <= 0) return;

    // Read inputs
    // Negate steering so that positive input = clockwise yaw (right turn)
    const steerAngle = -inputs.steering * this.maxSteerAngle;
    const throttle   = inputs.throttle;
    const brake      = inputs.brake;

    const fwdSpeed = this.getForwardSpeed();

    // ── Powertrain Shifting & RPM ──
    const gearRatio = this.gearRatios[this.currentGear];
    if (this.currentGear === 0) {
      // Neutral
      const targetRPM = this.idleRPM + throttle * (this.maxRPM - this.idleRPM) * 0.9;
      this.rpm += (targetRPM - this.rpm) * (1 - Math.exp(-4 * dt));
    } else {
      // In gear
      const rawRPM = Math.abs(fwdSpeed) * gearRatio * 260;
      this.rpm = Math.max(this.idleRPM, Math.min(rawRPM, this.maxRPM));
    }

    // Auto-shifting (only for forward gears 1-7)
    if (this.currentGear >= 1) {
      if (this.rpm > this.shiftUpRPM && this.currentGear < 7) {
        this.currentGear++;
      } else if (this.rpm < this.shiftDownRPM && this.currentGear > 1) {
        this.currentGear--;
      }
    }

    // Shifting to Reverse or 1st Gear when stopped
    if (Math.abs(fwdSpeed) < 0.15) {
      if (brake > 0.15 && this.currentGear !== -1) {
        this.currentGear = -1;
      } else if (throttle > 0.15 && this.currentGear === -1) {
        this.currentGear = 1;
      }
    }

    // ── Reset accumulators ─────────────────────────────────
    this._totalForce.set(0, 0, 0);
    this._totalTorque.set(0, 0, 0);

    // ── Gravity ────────────────────────────────────────────
    this._totalForce.y -= this.mass * 9.81;

    // ── Chassis basis vectors ──────────────────────────────
    this._forward.set(0, 0, -1).applyQuaternion(this.orientation);
    this._right.set(1, 0, 0).applyQuaternion(this.orientation);
    this._up.set(0, 1, 0).applyQuaternion(this.orientation);

    let groundedCount = 0;

    // ────────────────────────────────────────────────────────
    //  PER-WHEEL LOOP
    // ────────────────────────────────────────────────────────
    for (let i = 0; i < 4; i++) {

      // ── World-space wheel position ──────────────────────
      const wp = this._worldWP[i];
      wp.copy(this._localWheelPos[i])
        .applyQuaternion(this.orientation)
        .add(this.position);

      // ── Moment arm from centre-of-mass to wheel ─────────
      const r = this._v[0];
      r.subVectors(wp, this.position);

      // ── Raycast toward ground (Y = 0) ───────────────────
      const distToGround = wp.y;

      if (distToGround >= this.suspensionRestLength) {
        // Wheel in the air
        this.wheelGrounded[i]    = false;
        this.wheelCompression[i] = 0;
        continue;
      }

      // Wheel touching / compressed
      this.wheelGrounded[i] = true;
      groundedCount++;

      let compression = this.suspensionRestLength - distToGround;
      if (compression > this.suspensionRestLength) compression = this.suspensionRestLength;
      if (distToGround < 0) compression = this.suspensionRestLength; // fully compressed
      this.wheelCompression[i] = compression;

      // ── Velocity at wheel contact ───────────────────────
      //  v_wheel = v_body + ω × r
      const wv = this._v[1];
      wv.crossVectors(this.angularVelocity, r).add(this.velocity);

      // ═══════════════════════════════════════════════════
      //  A) SUSPENSION SPRING  (Hooke's Law: F = kx − cv)
      // ═══════════════════════════════════════════════════
      const vertVel = wv.y;
      let springF = this.springStiffness * compression
                  - this.dampingCoefficient * vertVel;
      if (springF < 0) springF = 0; // springs only push, never pull

      const fSpring = this._v[2];
      fSpring.set(0, springF, 0);
      this._totalForce.add(fSpring);

      // Torque: τ = r × F
      this._v[3].crossVectors(r, fSpring);
      this._totalTorque.add(this._v[3]);

      // ═══════════════════════════════════════════════════
      //  B) WHEEL HEADING  (steered for front, straight rear)
      // ═══════════════════════════════════════════════════
      const isFront = i < 2;
      const wFwd = this._v[4];

      if (isFront) {
        this._q0.setFromAxisAngle(this._up, steerAngle);
        wFwd.copy(this._forward).applyQuaternion(this._q0);
      } else {
        wFwd.copy(this._forward);
      }

      // Project onto XZ plane (remove vertical component)
      wFwd.y = 0;
      const fwdLen = wFwd.length();
      if (fwdLen > 1e-6) wFwd.divideScalar(fwdLen);
      else { wFwd.set(0, 0, -1); } // fallback

      // Wheel lateral (right) direction  =  90° CW of wFwd in XZ
      //   Equivalent to wFwd × (0,1,0) computed inline
      const wRt = this._v[5];
      wRt.set(-wFwd.z, 0, wFwd.x);

      // Decompose wheel velocity into longitudinal / lateral
      const fwdSpeed = wv.x * wFwd.x + wv.z * wFwd.z;  // dot in XZ
      const latSpeed = wv.x * wRt.x  + wv.z * wRt.z;

      // ═══════════════════════════════════════════════════
      //  C) LONGITUDINAL FORCE  (throttle & brake)
      // ═══════════════════════════════════════════════════
      const fLong = this._v[6];
      fLong.set(0, 0, 0);

      // — Throttle/Thrust (rear wheels only — RWD) —
      const thrustInput = this.currentGear === -1 ? brake : throttle;

      if (!isFront && thrustInput > 0 && this.currentGear !== 0) {
        // Torque multiplication based on gear ratio
        // We normalize torque relative to 1st gear ratio (3.0)
        let gearEffect = Math.abs(this.gearRatios[this.currentGear]) / 3.0;

        let thrust = thrustInput * this.engineForce * 0.5 * gearEffect;

        // Determine direction of thrust based on gear (Reverse or Forward)
        let thrustDir = this.currentGear === -1 ? -1 : 1;

        // Speed limiter with taper based on gear's theoretical max speed
        let gearMaxSpeed = this.maxSpeed;
        if (this.currentGear === -1) {
          gearMaxSpeed = 15; // Limit reverse speed to 54 km/h
        }

        const speedRatio = Math.abs(fwdSpeed) / gearMaxSpeed;
        if (speedRatio > 1)       thrust = 0;
        else if (speedRatio > 0.8) thrust *= (1 - speedRatio) / 0.2;

        fLong.x += wFwd.x * thrust * thrustDir;
        fLong.z += wFwd.z * thrust * thrustDir;
      }

      // — Braking (all wheels) —
      const brakeInput = this.currentGear === -1 ? throttle : brake;

      if (brakeInput > 0 && (fwdSpeed > 0.1 || fwdSpeed < -0.1)) {
        const brakeDir = fwdSpeed > 0 ? -1 : 1;
        const brakeMag = brakeInput * this.brakeForce * 0.25; // split 4 wheels

        fLong.x += wFwd.x * brakeDir * brakeMag;
        fLong.z += wFwd.z * brakeDir * brakeMag;
      }

      this._totalForce.add(fLong);

      // Torque from longitudinal force
      this._v[3].crossVectors(r, fLong);
      this._totalTorque.add(this._v[3]);

      // ═══════════════════════════════════════════════════
      //  D) LATERAL FORCE  (tire slip → cornering grip)
      // ═══════════════════════════════════════════════════
      //  Slip-proportional model capped by friction circle.
      let latForceMag = -this.corneringStiffness * latSpeed;

      // Friction limit:  μ × Fn   (μ ≈ 1.2 for racing slicks)
      const maxGrip = springF * 1.2;
      if (latForceMag >  maxGrip) latForceMag =  maxGrip;
      if (latForceMag < -maxGrip) latForceMag = -maxGrip;

      const fLat = this._v[7];
      fLat.set(wRt.x * latForceMag, 0, wRt.z * latForceMag);

      this._totalForce.add(fLat);

      // Torque from lateral force
      this._v[3].crossVectors(r, fLat);
      this._totalTorque.add(this._v[3]);
    }

    // ────────────────────────────────────────────────────────
    //  DRAG FORCES (only when grounded)
    // ────────────────────────────────────────────────────────
    const speed = this.velocity.length();

    if (speed > 0.01 && groundedCount > 0) {
      const drag = this._v[0];

      // Rolling resistance (constant, opposes velocity)
      drag.copy(this.velocity).normalize().multiplyScalar(-this.rollingResistance);
      this._totalForce.add(drag);

      // Aerodynamic drag (quadratic, opposes velocity)
      drag.copy(this.velocity).multiplyScalar(-this.aeroDragCoeff * speed);
      this._totalForce.add(drag);
    }

    // Low-speed friction clamp (prevents creep)
    if (speed < 0.3 && throttle < 0.01 && brake < 0.01 && groundedCount > 0) {
      this.velocity.multiplyScalar(1 - 8 * dt);
    }

    // ────────────────────────────────────────────────────────
    //  LINEAR INTEGRATION
    // ────────────────────────────────────────────────────────
    // a = F / m
    this.acceleration.copy(this._totalForce).divideScalar(this.mass);

    // v += a · dt
    this.velocity.addScaledVector(this.acceleration, dt);

    // p += v · dt
    this.position.addScaledVector(this.velocity, dt);

    // ────────────────────────────────────────────────────────
    //  ANGULAR INTEGRATION
    // ────────────────────────────────────────────────────────
    // α = τ / I   (component-wise diagonal inertia)
    this.angularVelocity.x += (this._totalTorque.x / this._inertia.x) * dt;
    this.angularVelocity.y += (this._totalTorque.y / this._inertia.y) * dt;
    this.angularVelocity.z += (this._totalTorque.z / this._inertia.z) * dt;

    // Angular damping
    const damp = 1 - this.angularDamping * dt;
    this.angularVelocity.multiplyScalar(damp > 0 ? damp : 0);

    // Orientation: axis-angle integration for small step
    const angSpeed = this.angularVelocity.length();
    if (angSpeed > 1e-6) {
      this._v[0].copy(this.angularVelocity).divideScalar(angSpeed); // axis
      this._q0.setFromAxisAngle(this._v[0], angSpeed * dt);
      this.orientation.premultiply(this._q0);
      this.orientation.normalize();
    }

    // ────────────────────────────────────────────────────────
    //  GROUND CONSTRAINT
    // ────────────────────────────────────────────────────────
    const minY = this.chassisHeight * 0.5;
    if (this.position.y < minY) {
      this.position.y = minY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // ────────────────────────────────────────────────────────
    //  SYNC MESH
    // ────────────────────────────────────────────────────────
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.orientation);

    // Wheel marker colors (green = contact, red = airborne)
    for (let i = 0; i < 4; i++) {
      this._wheelMarkers[i].material.color.setHex(
        this.wheelGrounded[i] ? 0x22ff44 : 0xff2244
      );
    }
  }

  // ================================================================
  //  ACCESSORS
  // ================================================================

  /** Current speed in km/h (scalar). */
  getSpeedKmh() {
    return this.velocity.length() * 3.6;
  }

  /**
   * Speed along the chassis forward axis (signed).
   * Positive = moving forward, negative = reversing.
   */
  getForwardSpeed() {
    // Reuse scratch vector (safe — not called inside update)
    this._v[0].set(0, 0, -1).applyQuaternion(this.orientation);
    return this.velocity.dot(this._v[0]);
  }

  /** Returns a reference to the position vector. */
  getPosition() {
    return this.position;
  }

  /** Reset the vehicle to a given position and zero all motion. */
  reset(pos) {
    this.position.copy(pos || new THREE.Vector3(0, 2, 0));
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.orientation.identity();
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.orientation);
  }

  /**
   * Returns a user-friendly string representation of the active gear.
   * @returns {string} "R", "N", or "1"-"7"
   */
  getGearName() {
    if (this.currentGear === -1) return 'R';
    if (this.currentGear === 0) return 'N';
    return String(this.currentGear);
  }


  // ================================================================
  //  CLEANUP
  // ================================================================

  dispose() {
    if (!this.mesh) return;

    this._scene.remove(this.mesh);

    // Dispose geometries and materials recursively
    this.mesh.traverse((child) => {
      if (child.geometry)  child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.mesh = null;
  }
}
