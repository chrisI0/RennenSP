/**
 * UniversalInputManager
 *
 * A unified input manager for racing simulation that handles:
 *   1. Hardware Gamepads / Steering Wheels (Web Gamepad API)
 *   2. Keyboard controls (WASD & Arrow Keys) with smooth ramping/decay
 *   3. Virtual Mouse steering & pedals (from absolute viewport coords)
 *
 * Features:
 *   • Dynamic device prioritization (Gamepad > Keyboard > Mouse)
 *   • Configurable deadzone for gamepad sticks and triggers
 *   • Key-state smoothing: steering ramps up at 3.0/s and decays to 0.0 at 4.0/s
 *   • Throttle and brake ramp up at 4.0/s and decay to 0.0 at 6.0/s
 *   • Upgraded visual HUD overlay displaying active device and inputs
 *   • Zero per-frame heap allocations
 */
export class UniversalInputManager {
  /**
   * @param {object} [options]
   * @param {number} [options.deadzone=0.05]          Deadzone for Gamepad sticks/triggers
   * @param {number} [options.steeringSensitivity=8]  Lerp speed for Mouse steering
   * @param {string} [options.autoCenterKey='Space']  KeyboardEvent.code for auto-centering
   * @param {boolean} [options.showOverlay=true]      Show the debug HUD overlay
   */
  constructor(options = {}) {
    // ── Configuration ──────────────────────────────────────
    this.deadzone = options.deadzone ?? 0.05;
    this.steeringSensitivity = options.steeringSensitivity ?? 8;
    this.autoCenterKey = options.autoCenterKey ?? 'Space';
    this.showOverlay = options.showOverlay ?? true;

    // ── Output values (read these in physics loop) ─────────
    this.steering = 0.0;  // -1.0 (Full Left) to 1.0 (Full Right)
    this.throttle = 0.0;  // 0.0 to 1.0
    this.brake = 0.0;     // 0.0 to 1.0

    // ── Device Priority State ──────────────────────────────
    this.activeDevice = 'Keyboard'; // 'Keyboard' | 'Mouse' | 'Gamepad'

    // ── Keyboard State ─────────────────────────────────────
    this.keys = {
      KeyW: false, ArrowUp: false,
      KeyA: false, ArrowLeft: false,
      KeyS: false, ArrowDown: false,
      KeyD: false, ArrowRight: false
    };
    this._autoCenterActive = false;

    // ── Mouse State ────────────────────────────────────────
    this._mouseX = 0;
    this._mouseY = 0;
    this._halfW = window.innerWidth * 0.5;
    this._halfH = window.innerHeight * 0.5;

    // ── HUD Overlay references ─────────────────────────────
    this._overlayRoot       = null;
    this._steerFillLeft     = null;
    this._steerFillRight    = null;
    this._steerLabel        = null;
    this._throttleFill      = null;
    this._throttleLabel     = null;
    this._brakeFill         = null;
    this._brakeLabel        = null;
    this._deviceLabel       = null;

    // ── Bind event handlers once to prevent garbage collection ──
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onKeyDown   = this._handleKeyDown.bind(this);
    this._onKeyUp     = this._handleKeyUp.bind(this);
    this._onResize    = this._handleResize.bind(this);

    // ── Attach listeners ───────────────────────────────────
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('resize', this._onResize);

    // ── Build HUD overlay ──────────────────────────────────
    if (this.showOverlay) {
      this._createOverlay();
    }
  }

  // ================================================================
  //  EVENT HANDLERS
  // ================================================================

  _handleMouseMove(e) {
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
    
    // Switch to Mouse only if not using Keyboard or active Gamepad
    if (this.activeDevice !== 'Gamepad' && !this._isAnyKeyboardKeyPressed()) {
      this.activeDevice = 'Mouse';
    }
  }

  _handleKeyDown(e) {
    if (e.code in this.keys) {
      this.keys[e.code] = true;
      this.activeDevice = 'Keyboard';
    }
    if (e.code === this.autoCenterKey) {
      this._autoCenterActive = true;
    }
  }

  _handleKeyUp(e) {
    if (e.code in this.keys) {
      this.keys[e.code] = false;
    }
    if (e.code === this.autoCenterKey) {
      this._autoCenterActive = false;
    }
  }

  _handleResize() {
    this._halfW = window.innerWidth * 0.5;
    this._halfH = window.innerHeight * 0.5;
  }

  _isAnyKeyboardKeyPressed() {
    return this.keys.KeyW || this.keys.ArrowUp ||
           this.keys.KeyA || this.keys.ArrowLeft ||
           this.keys.KeyS || this.keys.ArrowDown ||
           this.keys.KeyD || this.keys.ArrowRight;
  }

  // ================================================================
  //  CORE UPDATE — Call once per frame in your rendering loop
  // ================================================================

  update(dt) {
    // ── 1. Gamepad API Input Scanning ──
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gamepadActive = false;
    let gpSteer = 0.0;
    let gpThrottle = 0.0;
    let gpBrake = 0.0;

    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        // Read Left Stick X axis (Index 0)
        let rawSteer = gp.axes[0] || 0.0;
        if (Math.abs(rawSteer) > this.deadzone) {
          // Normalize and rescale outside deadzone
          const sign = rawSteer < 0 ? -1 : 1;
          gpSteer = sign * ((Math.abs(rawSteer) - this.deadzone) / (1 - this.deadzone));
        }

        // Read Triggers (Button 7 is Right Trigger / Throttle, Button 6 is Left Trigger / Brake)
        if (gp.buttons[7]) {
          const rawThrottle = gp.buttons[7].value;
          if (rawThrottle > this.deadzone) gpThrottle = rawThrottle;
        }
        if (gp.buttons[6]) {
          const rawBrake = gp.buttons[6].value;
          if (rawBrake > this.deadzone) gpBrake = rawBrake;
        }

        // If gamepad is active and registers inputs beyond drift/deadzone, prioritize it
        if (Math.abs(gpSteer) > 0.0 || gpThrottle > 0.0 || gpBrake > 0.0) {
          gamepadActive = true;
          break;
        }
      }
    }

    if (gamepadActive) {
      this.activeDevice = 'Gamepad';
      this.steering = gpSteer;
      this.throttle = gpThrottle;
      this.brake = gpBrake;
    }

    // ── 2. Keyboard Auto-Center Handling ──
    if (this._autoCenterActive) {
      this.steering = 0.0;
      this.throttle = 0.0;
      this.brake = 0.0;
      this._updateOverlay();
      return;
    }

    // ── 3. Keyboard / Mouse Fallbacks ──
    if (!gamepadActive) {
      // If any key is pressed or we were already on Keyboard mode
      if (this._isAnyKeyboardKeyPressed() || this.activeDevice === 'Keyboard') {
        this.activeDevice = 'Keyboard';
        this._updateKeyboardInput(dt);
      } else {
        this.activeDevice = 'Mouse';
        this._updateMouseInput(dt);
      }
    }

    // ── 4. UI Telemetry Refresh ──
    this._updateOverlay();
  }

  // ================================================================
  //  DEVICE-SPECIFIC SUB-UPDATES
  // ================================================================

  _updateKeyboardInput(dt) {
    const isW = this.keys.KeyW || this.keys.ArrowUp;
    const isA = this.keys.KeyA || this.keys.ArrowLeft;
    const isS = this.keys.KeyS || this.keys.ArrowDown;
    const isD = this.keys.KeyD || this.keys.ArrowRight;

    // Target values
    let targetSteer = 0.0;
    if (isA && !isD) targetSteer = -1.0;
    else if (isD && !isA) targetSteer = 1.0;

    let targetThrottle = isW ? 1.0 : 0.0;
    let targetBrake    = isS ? 1.0 : 0.0;

    // Steering ramping: 3.0 units/s to turn, 4.0 units/s to center
    if (targetSteer !== 0.0) {
      if (targetSteer > this.steering) {
        this.steering = Math.min(targetSteer, this.steering + 3.0 * dt);
      } else {
        this.steering = Math.max(targetSteer, this.steering - 3.0 * dt);
      }
    } else {
      if (this.steering > 0.0) {
        this.steering = Math.max(0.0, this.steering - 4.0 * dt);
      } else if (this.steering < 0.0) {
        this.steering = Math.min(0.0, this.steering + 4.0 * dt);
      }
    }

    // Throttle ramping: 4.0 units/s to apply, 6.0 units/s to release
    if (targetThrottle > this.throttle) {
      this.throttle = Math.min(targetThrottle, this.throttle + 4.0 * dt);
    } else {
      this.throttle = Math.max(0.0, this.throttle - 6.0 * dt);
    }

    // Brake ramping: 4.0 units/s to apply, 6.0 units/s to release
    if (targetBrake > this.brake) {
      this.brake = Math.min(targetBrake, this.brake + 4.0 * dt);
    } else {
      this.brake = Math.max(0.0, this.brake - 6.0 * dt);
    }
  }

  _updateMouseInput(dt) {
    let normX = (this._mouseX - this._halfW) / this._halfW;
    let normY = (this._halfH - this._mouseY) / this._halfH;

    // Apply deadzone and clamp to bounds
    normX = this._applyDeadzone(normX);
    normY = this._applyDeadzone(normY);

    const rawSteer = this._clamp(normX, -1, 1);
    const rawY     = this._clamp(normY, -1, 1);

    // Mouse steering lerp smoothing
    const lerpFactor = 1 - Math.exp(-this.steeringSensitivity * dt);
    this.steering = this.steering + (rawSteer - this.steering) * lerpFactor;
    this.steering = this._clamp(this.steering, -1, 1);

    // Split Y axis into throttle & brake
    if (rawY > 0) {
      this.throttle = rawY;
      this.brake = 0.0;
    } else {
      this.throttle = 0.0;
      this.brake = -rawY;
    }
  }

  // ================================================================
  //  MATH HELPERS
  // ================================================================

  _applyDeadzone(value) {
    const abs = Math.abs(value);
    if (abs < this.deadzone) return 0.0;
    const sign = value < 0 ? -1 : 1;
    return sign * ((abs - this.deadzone) / (1.0 - this.deadzone));
  }

  _clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // ================================================================
  //  HUD OVERLAY CREATION & REFRESH
  // ================================================================

  _createOverlay() {
    const root = document.createElement('div');
    root.id = 'msim-overlay';
    root.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: flex-end;
      gap: 16px;
      pointer-events: none;
      z-index: 999;
      font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
      user-select: none;
    `;

    // Pedals panel
    const pedalsContainer = document.createElement('div');
    pedalsContainer.style.cssText = `
      display: flex;
      gap: 6px;
      align-items: flex-end;
    `;

    const throttleWrap = this._createVerticalBar('T', '#22c55e', 'msim-throttle');
    this._throttleFill = throttleWrap.querySelector('.msim-bar-fill');
    this._throttleLabel = throttleWrap.querySelector('.msim-bar-label');

    const brakeWrap = this._createVerticalBar('B', '#ef4444', 'msim-brake');
    this._brakeFill = brakeWrap.querySelector('.msim-bar-fill');
    this._brakeLabel = brakeWrap.querySelector('.msim-bar-label');

    pedalsContainer.appendChild(throttleWrap);
    pedalsContainer.appendChild(brakeWrap);

    // Steering panel
    const steerWrap = document.createElement('div');
    steerWrap.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    `;

    // Active Device Label
    const deviceLabel = document.createElement('div');
    deviceLabel.id = 'msim-device';
    deviceLabel.style.cssText = `
      font-size: 9px;
      color: #3b82f6;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 700;
      margin-bottom: 2px;
      transition: color 0.2s ease;
    `;
    deviceLabel.textContent = 'INPUT: KEYBOARD';
    this._deviceLabel = deviceLabel;
    steerWrap.appendChild(deviceLabel);

    const steerBarOuter = document.createElement('div');
    steerBarOuter.style.cssText = `
      width: 280px;
      height: 18px;
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(8px);
    `;

    const centerLine = document.createElement('div');
    centerLine.style.cssText = `
      position: absolute;
      left: 50%;
      top: 0;
      width: 1px;
      height: 100%;
      background: rgba(255, 255, 255, 0.25);
      z-index: 2;
    `;
    steerBarOuter.appendChild(centerLine);

    const steerFillLeft = document.createElement('div');
    steerFillLeft.style.cssText = `
      position: absolute;
      right: 50%;
      top: 0;
      width: 0%;
      height: 100%;
      background: linear-gradient(270deg, #f59e0b, #d97706);
      border-radius: 2px 0 0 2px;
    `;
    steerBarOuter.appendChild(steerFillLeft);
    this._steerFillLeft = steerFillLeft;

    const steerFillRight = document.createElement('div');
    steerFillRight.style.cssText = `
      position: absolute;
      left: 50%;
      top: 0;
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #d97706);
      border-radius: 0 2px 2px 0;
    `;
    steerBarOuter.appendChild(steerFillRight);
    this._steerFillRight = steerFillRight;

    const steerLabel = document.createElement('div');
    steerLabel.style.cssText = `
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      letter-spacing: 0.05em;
    `;
    steerLabel.textContent = 'STR 0%';
    this._steerLabel = steerLabel;

    steerWrap.appendChild(steerBarOuter);
    steerWrap.appendChild(steerLabel);

    root.appendChild(pedalsContainer);
    root.appendChild(steerWrap);
    document.body.appendChild(root);
    this._overlayRoot = root;
  }

  _createVerticalBar(letter, color, id) {
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    `;

    const barOuter = document.createElement('div');
    barOuter.style.cssText = `
      width: 24px;
      height: 90px;
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(8px);
    `;

    const fill = document.createElement('div');
    fill.className = 'msim-bar-fill';
    fill.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 0%;
      background: ${color};
      border-radius: 2px;
    `;
    barOuter.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'msim-bar-label';
    label.style.cssText = `
      font-size: 9px;
      color: rgba(255, 255, 255, 0.4);
      letter-spacing: 0.05em;
    `;
    label.textContent = `${letter} 0%`;

    wrap.appendChild(barOuter);
    wrap.appendChild(label);
    return wrap;
  }

  _updateOverlay() {
    if (!this._overlayRoot) return;

    // ── 1. Device Label ──
    if (this._deviceLabel) {
      this._deviceLabel.textContent = `INPUT: ${this.activeDevice}`;
      if (this.activeDevice === 'Gamepad') {
        this._deviceLabel.style.color = '#10b981'; // Green
      } else if (this.activeDevice === 'Keyboard') {
        this._deviceLabel.style.color = '#3b82f6'; // Blue
      } else {
        this._deviceLabel.style.color = '#f59e0b'; // Amber (Mouse)
      }
    }

    // ── 2. Steering Bar ──
    const steerPct = this.steering * 100;
    if (this.steering < 0.0) {
      this._steerFillLeft.style.width = `${-steerPct * 0.5}%`;
      this._steerFillRight.style.width = '0%';
    } else {
      this._steerFillLeft.style.width = '0%';
      this._steerFillRight.style.width = `${steerPct * 0.5}%`;
    }
    const steerRounded = Math.abs(steerPct) | 0;
    const steerDir = this.steering < -0.01 ? 'L' : this.steering > 0.01 ? 'R' : '';
    this._steerLabel.textContent = `STR ${steerDir} ${steerRounded}%`;

    // ── 3. Throttle Bar ──
    const throttlePct = (this.throttle * 100) | 0;
    this._throttleFill.style.height = `${throttlePct}%`;
    this._throttleLabel.textContent = `T ${throttlePct}%`;

    // ── 4. Brake Bar ──
    const brakePct = (this.brake * 100) | 0;
    this._brakeFill.style.height = `${brakePct}%`;
    this._brakeLabel.textContent = `B ${brakePct}%`;
  }

  // ================================================================
  //  CLEANUP
  // ================================================================

  dispose() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);

    if (this._overlayRoot && this._overlayRoot.parentNode) {
      this._overlayRoot.parentNode.removeChild(this._overlayRoot);
    }

    this._overlayRoot    = null;
    this._steerFillLeft  = null;
    this._steerFillRight = null;
    this._steerLabel     = null;
    this._throttleFill   = null;
    this._throttleLabel  = null;
    this._brakeFill      = null;
    this._brakeLabel     = null;
    this._deviceLabel    = null;
  }
}
