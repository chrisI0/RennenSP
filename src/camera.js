import * as THREE from 'three';

/**
 * Free-roam camera controller for exploring the 3D scene.
 *
 * Controls:
 *   W/S        — Move forward/backward
 *   A/D        — Strafe left/right
 *   Shift      — Sprint (2x speed)
 *   Right-click drag / Middle-click drag — Pan/look around
 *   Scroll     — Adjust base movement speed
 */
export class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLCanvasElement} canvas
   */
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;

    // Movement settings
    this.baseSpeed = 15;        // meters per second
    this.minSpeed = 2;
    this.maxSpeed = 100;
    this.sprintMultiplier = 2.5;
    this.damping = 8;           // lower = more sluggish, higher = snappier

    // Mouse look settings
    this.lookSensitivity = 0.002;
    this.pitchMin = -Math.PI / 2 + 0.1;  // prevent looking straight down
    this.pitchMax = Math.PI / 2 - 0.1;   // prevent looking straight up

    // State
    this._yaw = -Math.PI / 2;   // start looking along -Z
    this._pitch = -0.2;         // slight downward tilt
    this._velocity = new THREE.Vector3();
    this._targetVelocity = new THREE.Vector3();
    this._isLooking = false;
    this._keys = new Set();
    this._currentSpeed = 0;

    // Temp vectors (reuse for performance)
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();

    // Apply initial rotation
    this._updateCameraRotation();

    // Bind event handlers
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);

    this._attachEvents();
  }

  _attachEvents() {
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  _onKeyDown(e) {
    this._keys.add(e.code);
  }

  _onKeyUp(e) {
    this._keys.delete(e.code);
  }

  _onMouseDown(e) {
    // Right-click (button 2) or middle-click (button 1)
    if (e.button === 2 || e.button === 1) {
      this._isLooking = true;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  _onMouseUp(e) {
    if (e.button === 2 || e.button === 1) {
      this._isLooking = false;
      this.canvas.style.cursor = 'grab';
    }
  }

  _onMouseMove(e) {
    if (!this._isLooking) return;

    this._yaw -= e.movementX * this.lookSensitivity;
    this._pitch -= e.movementY * this.lookSensitivity;

    // Clamp pitch
    this._pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this._pitch));

    this._updateCameraRotation();
  }

  _onWheel(e) {
    e.preventDefault();
    const scrollDelta = e.deltaY > 0 ? -1 : 1;
    this.baseSpeed = Math.max(
      this.minSpeed,
      Math.min(this.maxSpeed, this.baseSpeed * (1 + scrollDelta * 0.1))
    );
  }

  _onContextMenu(e) {
    e.preventDefault();
  }

  _updateCameraRotation() {
    // Build a quaternion from yaw and pitch
    const euler = new THREE.Euler(this._pitch, this._yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  /**
   * Get the forward direction projected onto the XZ plane (horizontal).
   */
  _getForward() {
    this._forward.set(0, 0, -1);
    this._forward.applyQuaternion(this.camera.quaternion);
    this._forward.y = 0;
    this._forward.normalize();
    return this._forward;
  }

  /**
   * Get the right direction projected onto the XZ plane.
   */
  _getRight() {
    this._right.set(1, 0, 0);
    this._right.applyQuaternion(this.camera.quaternion);
    this._right.y = 0;
    this._right.normalize();
    return this._right;
  }

  /**
   * Update camera position and rotation. Call once per frame.
   * @param {number} dt — delta time in seconds
   */
  update(dt) {
    // Compute desired movement direction
    this._moveDir.set(0, 0, 0);

    const forward = this._getForward();
    const right = this._getRight();

    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) {
      this._moveDir.add(forward);
    }
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) {
      this._moveDir.sub(forward);
    }
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) {
      this._moveDir.add(right);
    }
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) {
      this._moveDir.sub(right);
    }

    // Vertical movement
    if (this._keys.has('Space')) {
      this._moveDir.y += 1;
    }
    if (this._keys.has('ControlLeft') || this._keys.has('ControlRight')) {
      this._moveDir.y -= 1;
    }

    // Normalize if moving diagonally
    if (this._moveDir.lengthSq() > 0) {
      this._moveDir.normalize();
    }

    // Speed with sprint
    const isSprinting = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight');
    const speed = this.baseSpeed * (isSprinting ? this.sprintMultiplier : 1);

    // Target velocity
    this._targetVelocity.copy(this._moveDir).multiplyScalar(speed);

    // Smooth damp towards target velocity
    const lerpFactor = 1 - Math.exp(-this.damping * dt);
    this._velocity.lerp(this._targetVelocity, lerpFactor);

    // Store current speed for HUD
    this._currentSpeed = this._velocity.length();

    // Apply movement
    this.camera.position.addScaledVector(this._velocity, dt);

    // Keep camera above ground
    if (this.camera.position.y < 0.5) {
      this.camera.position.y = 0.5;
    }
  }

  /**
   * Returns the current movement speed in m/s.
   * @returns {number}
   */
  getSpeed() {
    return this._currentSpeed;
  }

  /**
   * Dispose of event listeners.
   */
  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
  }
}
