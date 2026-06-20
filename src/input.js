/**
 * MouseSimInputManager
 *
 * A virtual 2-axis analog controller for racing simulation.
 * Maps the absolute mouse position on the viewport to:
 *   - Horizontal (X): Steering  → -1.0 (full left) to +1.0 (full right)
 *   - Vertical   (Y): Throttle  →  0.0 to +1.0 (mouse forward / up)
 *                      Brake     →  0.0 to -1.0 (mouse backward / down)
 *
 * Features:
 *   • Adjustable deadzone near center
 *   • Lerp-smoothed steering output with configurable sensitivity
 *   • Auto-center key (default: Space)
 *   • DOM-injected debug overlay (steering bar, throttle bar, brake bar)
 *   • Zero per-frame heap allocations
 *   • Full dispose() cleanup
 */
export class MouseSimInputManager {
  /**
   * @param {object} [options]
   * @param {number} [options.deadzone=0.04]         Deadzone radius (0–1 normalized)
   * @param {number} [options.steeringSensitivity=8]  Lerp speed for steering smoothing (higher = faster)
   * @param {number} [options.autoCenterKey='Space']  KeyboardEvent.code for auto-center
   * @param {boolean} [options.showOverlay=true]      Show the debug HUD overlay
   */
  constructor(options = {}) {
    // ── Configuration ──────────────────────────────────────
    this.deadzone = options.deadzone ?? 0.04;
    this.steeringSensitivity = options.steeringSensitivity ?? 8;
    this.autoCenterKey = options.autoCenterKey ?? 'Space';
    this.showOverlay = options.showOverlay ?? true;

    // ── Output values (read these externally) ──────────────
    /** Current smoothed steering value. -1 = full left, +1 = full right */
    this.steering = 0;
    /** Current throttle value. 0 = idle, 1 = full throttle */
    this.throttle = 0;
    /** Current brake value. 0 = idle, 1 = full brake */
    this.brake = 0;

    // ── Internal raw state (reused — zero alloc) ───────────
    this._rawSteer = 0;    // raw normalized X before smoothing
    this._rawY = 0;        // raw normalized Y (negative = throttle, positive = brake on screen)
    this._mouseX = 0;      // absolute pixel X from last event
    this._mouseY = 0;      // absolute pixel Y from last event
    this._halfW = window.innerWidth * 0.5;
    this._halfH = window.innerHeight * 0.5;
    this._autoCenterActive = false;

    // ── Overlay DOM references ─────────────────────────────
    this._overlayRoot = null;
    this._steerFillLeft = null;
    this._steerFillRight = null;
    this._steerLabel = null;
    this._throttleFill = null;
    this._throttleLabel = null;
    this._brakeFill = null;
    this._brakeLabel = null;

    // ── Bind event handlers once (prevents GC churn) ───────
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onResize = this._handleResize.bind(this);

    // ── Attach listeners ───────────────────────────────────
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('resize', this._onResize);

    // ── Build overlay ──────────────────────────────────────
    if (this.showOverlay) {
      this._createOverlay();
    }
  }

  // ================================================================
  //  EVENT HANDLERS (zero-alloc — mutate existing primitives only)
  // ================================================================

  /** @param {MouseEvent} e */
  _handleMouseMove(e) {
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
  }

  /** @param {KeyboardEvent} e */
  _handleKeyDown(e) {
    if (e.code === this.autoCenterKey) {
      this._autoCenterActive = true;
    }
  }

  /** @param {KeyboardEvent} e */
  _handleKeyUp(e) {
    if (e.code === this.autoCenterKey) {
      this._autoCenterActive = false;
    }
  }

  _handleResize() {
    this._halfW = window.innerWidth * 0.5;
    this._halfH = window.innerHeight * 0.5;
  }

  // ================================================================
  //  CORE UPDATE — call once per frame from your game loop
  // ================================================================

  /**
   * Processes raw mouse position into smoothed outputs.
   * Must be called every frame with the frame's delta time.
   *
   * @param {number} dt  Delta time in seconds
   */
  update(dt) {
    // ── Auto-center override ───────────────────────────────
    if (this._autoCenterActive) {
      this._rawSteer = 0;
      this._rawY = 0;
      this.steering = 0;
      this.throttle = 0;
      this.brake = 0;
      this._updateOverlay();
      return;
    }

    // ── Compute normalized axes from mouse position ────────
    // X: (mouseX - center) / halfWidth  → -1…+1
    // Y: (center - mouseY) / halfHeight → -1…+1  (inverted: up = positive)
    let normX = (this._mouseX - this._halfW) / this._halfW;
    let normY = (this._halfH - this._mouseY) / this._halfH;

    // ── Apply deadzone ─────────────────────────────────────
    normX = this._applyDeadzone(normX);
    normY = this._applyDeadzone(normY);

    // ── Clamp to -1…+1 ────────────────────────────────────
    this._rawSteer = this._clamp(normX, -1, 1);
    this._rawY = this._clamp(normY, -1, 1);

    // ── Lerp-smooth the steering ───────────────────────────
    // Use exponential smoothing: factor = 1 - e^(-sensitivity * dt)
    const lerpFactor = 1 - Math.exp(-this.steeringSensitivity * dt);
    this.steering = this.steering + (this._rawSteer - this.steering) * lerpFactor;

    // ── Clamp steering output after lerp ───────────────────
    this.steering = this._clamp(this.steering, -1, 1);

    // ── Split Y into throttle / brake (no smoothing needed) ─
    if (this._rawY > 0) {
      this.throttle = this._rawY;
      this.brake = 0;
    } else {
      this.throttle = 0;
      this.brake = -this._rawY; // flip sign so brake is 0…1
    }

    // ── Update debug overlay ───────────────────────────────
    this._updateOverlay();
  }

  // ================================================================
  //  MATH HELPERS (inlined for zero-alloc)
  // ================================================================

  /**
   * Applies deadzone with rescaling so output ramps smoothly from 0
   * at the edge of the deadzone to the raw value at ±1.
   * @param {number} value
   * @returns {number}
   */
  _applyDeadzone(value) {
    const abs = value < 0 ? -value : value;
    if (abs < this.deadzone) return 0;
    // Rescale so edge-of-deadzone → 0, ±1 → ±1
    const sign = value < 0 ? -1 : 1;
    return sign * ((abs - this.deadzone) / (1 - this.deadzone));
  }

  /**
   * @param {number} v
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // ================================================================
  //  DEBUG OVERLAY
  // ================================================================

  _createOverlay() {
    // ── Root container ─────────────────────────────────────
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

    // ── Throttle / Brake vertical bars container ───────────
    const pedalsContainer = document.createElement('div');
    pedalsContainer.style.cssText = `
      display: flex;
      gap: 6px;
      align-items: flex-end;
    `;

    // Throttle bar
    const throttleWrap = this._createVerticalBar('T', '#22c55e', 'msim-throttle');
    this._throttleFill = throttleWrap.querySelector('.msim-bar-fill');
    this._throttleLabel = throttleWrap.querySelector('.msim-bar-label');

    // Brake bar
    const brakeWrap = this._createVerticalBar('B', '#ef4444', 'msim-brake');
    this._brakeFill = brakeWrap.querySelector('.msim-bar-fill');
    this._brakeLabel = brakeWrap.querySelector('.msim-bar-label');

    pedalsContainer.appendChild(throttleWrap);
    pedalsContainer.appendChild(brakeWrap);

    // ── Steering horizontal bar ────────────────────────────
    const steerWrap = document.createElement('div');
    steerWrap.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    `;

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

    // Center line
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

    // Left fill (for negative steering)
    const steerFillLeft = document.createElement('div');
    steerFillLeft.style.cssText = `
      position: absolute;
      right: 50%;
      top: 0;
      width: 0%;
      height: 100%;
      background: linear-gradient(270deg, #f59e0b, #d97706);
      border-radius: 2px 0 0 2px;
      transition: none;
    `;
    steerBarOuter.appendChild(steerFillLeft);
    this._steerFillLeft = steerFillLeft;

    // Right fill (for positive steering)
    const steerFillRight = document.createElement('div');
    steerFillRight.style.cssText = `
      position: absolute;
      left: 50%;
      top: 0;
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #d97706);
      border-radius: 0 2px 2px 0;
      transition: none;
    `;
    steerBarOuter.appendChild(steerFillRight);
    this._steerFillRight = steerFillRight;

    // Label
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

    // ── Assemble ───────────────────────────────────────────
    root.appendChild(pedalsContainer);
    root.appendChild(steerWrap);

    document.body.appendChild(root);
    this._overlayRoot = root;
  }

  /**
   * Creates a vertical bar element for throttle or brake.
   * @param {string} letter   Single-char label
   * @param {string} color    CSS color for the fill
   * @param {string} id       Unique element id
   * @returns {HTMLDivElement}
   */
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
      transition: none;
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

  /**
   * Updates the debug overlay DOM. Called from update().
   * Uses direct style.width / style.height mutations — no layout thrashing
   * because reads (none) and writes are not interleaved.
   */
  _updateOverlay() {
    if (!this._overlayRoot) return;

    // ── Steering bar ───────────────────────────────────────
    const steerPct = this.steering * 100;
    if (this.steering < 0) {
      this._steerFillLeft.style.width = `${-steerPct * 0.5}%`;
      this._steerFillRight.style.width = '0%';
    } else {
      this._steerFillLeft.style.width = '0%';
      this._steerFillRight.style.width = `${steerPct * 0.5}%`;
    }
    // Round to avoid excessive string allocations from toFixed
    const steerRounded = (steerPct < 0 ? -steerPct : steerPct) | 0;
    const steerDir = this.steering < -0.01 ? 'L' : this.steering > 0.01 ? 'R' : '';
    this._steerLabel.textContent = `STR ${steerDir} ${steerRounded}%`;

    // ── Throttle bar ───────────────────────────────────────
    const throttlePct = (this.throttle * 100) | 0;
    this._throttleFill.style.height = `${throttlePct}%`;
    this._throttleLabel.textContent = `T ${throttlePct}%`;

    // ── Brake bar ──────────────────────────────────────────
    const brakePct = (this.brake * 100) | 0;
    this._brakeFill.style.height = `${brakePct}%`;
    this._brakeLabel.textContent = `B ${brakePct}%`;
  }

  // ================================================================
  //  CONFIGURATION API
  // ================================================================

  /**
   * Set the deadzone radius (0–1).
   * @param {number} value
   */
  setDeadzone(value) {
    this.deadzone = this._clamp(value, 0, 0.5);
  }

  /**
   * Set steering smoothing sensitivity. Higher = faster response.
   * @param {number} value
   */
  setSensitivity(value) {
    this.steeringSensitivity = this._clamp(value, 0.5, 50);
  }

  /**
   * Show or hide the debug overlay.
   * @param {boolean} visible
   */
  setOverlayVisible(visible) {
    if (this._overlayRoot) {
      this._overlayRoot.style.display = visible ? 'flex' : 'none';
    }
  }

  // ================================================================
  //  CLEANUP
  // ================================================================

  /**
   * Removes all event listeners and DOM elements.
   * Call this when the input manager is no longer needed.
   */
  dispose() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);

    if (this._overlayRoot && this._overlayRoot.parentNode) {
      this._overlayRoot.parentNode.removeChild(this._overlayRoot);
    }

    this._overlayRoot = null;
    this._steerFillLeft = null;
    this._steerFillRight = null;
    this._steerLabel = null;
    this._throttleFill = null;
    this._throttleLabel = null;
    this._brakeFill = null;
    this._brakeLabel = null;
  }
}
