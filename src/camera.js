import * as THREE from 'three';

/**
 * SimVehicleCameraManager
 *
 * High-performance chase camera that tracks a SimpleRaycastVehicle chassis.
 *
 * Features:
 *   • Smooth exponential-lerp position/rotation following using THREE.Vector3.lerp
 *   • Stable horizontal-only camera positioning to prevent sinking under pitch
 *   • Height guardrail preventing the camera from dipping below 0.8m Y
 *   • Speed-based dynamic FOV
 *   • Zero per-frame heap allocations
 */
export class SimVehicleCameraManager {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} [options]
   */
  constructor(camera, options = {}) {
    this.camera = camera;

    // Camera geometry
    this.followDistance    = options.followDistance    ?? 6.0;
    this.followHeight     = options.followHeight     ?? 2.2;
    this.lookAheadDistance = options.lookAheadDistance ?? 1.5; // target = car position + car forward vector * 1.5

    // Smoothing rates
    this.positionSmoothing = options.positionSmoothing ?? 5.0;
    this.lookAtSmoothing   = options.lookAtSmoothing   ?? 5.0;

    // Dynamic FOV
    this.baseFOV        = options.baseFOV        ?? 65;
    this.maxFOV         = options.maxFOV         ?? 78;
    this.maxSpeedForFOV = options.maxSpeedForFOV ?? 65; // m/s (approx 234 km/h)

    // Height Guardrail
    this.minHeight = 0.8; // Y coordinate never drops below 0.8 meters relative to the ground plane

    // Pre-allocated vectors for zero per-frame heap allocation
    this._idealPos     = new THREE.Vector3();
    this._idealLookAt  = new THREE.Vector3();
    this._smoothLookAt = new THREE.Vector3();
    this._carForward   = new THREE.Vector3();
    this._carForwardXZ = new THREE.Vector3();
    
    this._initialized  = false;
  }

  /**
   * Advance the camera for one frame.
   *
   * @param {number}         dt                Frame delta time (seconds)
   * @param {THREE.Object3D} vehicleChassisMesh  The vehicle's mesh (position + quaternion)
   * @param {THREE.Vector3}  [vehicleVelocity]   The vehicle's world-space velocity vector (optional, for dynamic FOV)
   */
  update(dt, vehicleChassisMesh, vehicleVelocity) {
    if (dt <= 0) return;

    const carPos  = vehicleChassisMesh.position;
    const carQuat = vehicleChassisMesh.quaternion;

    // 1. Calculate car's 3D forward vector (-Z is forward in Three.js standard for this model)
    this._carForward.set(0, 0, -1).applyQuaternion(carQuat).normalize();

    // 2. Project forward vector to XZ plane and normalize for stable behind position calculation.
    // This stops the camera from sinking down when the vehicle pitches up under acceleration.
    this._carForwardXZ.copy(this._carForward);
    this._carForwardXZ.y = 0;
    if (this._carForwardXZ.lengthSq() > 1e-6) {
      this._carForwardXZ.normalize();
    } else {
      this._carForwardXZ.set(0, 0, -1);
    }

    // 3. Ideal Position: Float exactly 6.0 meters behind the car and 2.2 meters above it
    this._idealPos.copy(carPos).addScaledVector(this._carForwardXZ, -this.followDistance);
    this._idealPos.y += this.followHeight;

    // 4. Look-At Target: Look at a point slightly ahead of the car's center (e.g. target = car position + car forward vector * 1.5)
    this._idealLookAt.copy(carPos).addScaledVector(this._carForward, this.lookAheadDistance);

    // 5. First-frame snap
    if (!this._initialized) {
      this.camera.position.copy(this._idealPos);
      this._smoothLookAt.copy(this._idealLookAt);

      // Apply height guardrail
      if (this.camera.position.y < this.minHeight) {
        this.camera.position.y = this.minHeight;
      }

      this.camera.lookAt(this._smoothLookAt);
      this.camera.fov = this.baseFOV;
      this.camera.updateProjectionMatrix();
      this._initialized = true;
      return;
    }

    // 6. Smooth Follow (Lerp): Use THREE.Vector3.lerp with robust alpha factor tied to dt
    const posAlpha  = 1 - Math.exp(-this.positionSmoothing * dt);
    const lookAlpha = 1 - Math.exp(-this.lookAtSmoothing * dt);

    this.camera.position.lerp(this._idealPos, posAlpha);
    this._smoothLookAt.lerp(this._idealLookAt, lookAlpha);

    // 7. Height Guardrail: Never drop below 0.8 meters relative to the ground plane
    if (this.camera.position.y < this.minHeight) {
      this.camera.position.y = this.minHeight;
    }

    // 8. Apply Look-At
    this.camera.lookAt(this._smoothLookAt);

    // 9. Dynamic FOV based on speed (optional/premium effect)
    if (vehicleVelocity) {
      const speed = vehicleVelocity.length();
      const speedRatio = Math.min(Math.max(speed / this.maxSpeedForFOV, 0), 1);
      const targetFOV = this.baseFOV + (this.maxFOV - this.baseFOV) * speedRatio;
      const fovAlpha  = 1 - Math.exp(-3 * dt);
      this.camera.fov += (targetFOV - this.camera.fov) * fovAlpha;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Force camera to snap immediately to target */
  snapToTarget() {
    this._initialized = false;
  }

  dispose() {
    this.camera.fov = this.baseFOV;
    this.camera.updateProjectionMatrix();
  }
}
