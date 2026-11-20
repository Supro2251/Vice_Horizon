import {
  ControlSettings,
  GamepadButtonAction,
  KeyAction,
  StickControlConfig,
  VehicleControlCategory,
} from '../types/game';
import { DEFAULT_SETTINGS } from '../data/defaults';

export interface InputFrameState {
  moveX: number; // -1 left, +1 right
  moveY: number; // -1 back, +1 forward
  leftStickX: number; // -1..1 analog + keyboard fallback
  leftStickY: number; // -1..1
  rightStickX: number; // -1..1
  rightStickY: number; // -1..1
  padLeftStickX: number; // -1..1 raw gamepad stick only (up = +1, down = -1)
  padLeftStickY: number; // -1..1 raw gamepad stick only
  padRightStickX: number; // -1..1 raw gamepad stick only
  padRightStickY: number; // -1..1 raw gamepad stick only
  lookDeltaX: number;
  lookDeltaY: number;
  throttle: number; // 0..1
  brake: number; // 0..1
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  handbrakeHeld: boolean;
  shootHeld: boolean;
  shootPressed: boolean;
  aimHeld: boolean;
  reloadPressed: boolean;
  enterVehiclePressed: boolean;
  carjackPressed: boolean;
  switchCameraPressed: boolean;
  hornHeld: boolean;
  l1Held: boolean;
  r1Held: boolean;
  l3Pressed: boolean;
  pitchUpHeld: boolean;
  pitchDownHeld: boolean;
  stickConfig: StickControlConfig;
  controllerConnected: boolean;
  controllerType: 'playstation' | 'xbox' | 'none';
  controllerName: string;
}

export function detectControllerType(id: string): 'playstation' | 'xbox' {
  const lower = id.toLowerCase();
  if (
    lower.includes('054c') ||
    lower.includes('sony') ||
    lower.includes('dualshock') ||
    lower.includes('dualsense') ||
    lower.includes('ps4') ||
    lower.includes('ps5') ||
    lower.includes('wireless controller')
  ) {
    return 'playstation';
  }
  return 'xbox';
}

export const PLAYSTATION_GLYPHS: Record<number, string> = {
  0: '×',
  1: '○',
  2: '□',
  3: '△',
  4: 'L1',
  5: 'R1',
  6: 'L2',
  7: 'R2',
  8: 'Share',
  9: 'Options',
  10: 'L3',
  11: 'R3',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
  16: 'PS',
  17: 'Touchpad',
};

export const XBOX_GLYPHS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'View',
  9: 'Menu',
  10: 'LS',
  11: 'RS',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
  16: 'Guide',
  17: 'Touch',
};

export function formatKeyCode(code: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Space') return 'Medzerník';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export class InputManager {
  private keysDown = new Set<string>();
  private mouseButtonsDown = new Set<number>();
  private prevActions = new Set<string>();
  private prevGamepadButtons = new Map<number, boolean>();

  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private settings: ControlSettings = structuredClone(DEFAULT_SETTINGS.controls);
  private targetElement: HTMLElement | null = null;
  public isPointerLocked = false;
  public paused = false;
  public inAircraft = false;
  public controlCategory: VehicleControlCategory = 'foot';

  // Callbacks for global modal triggers
  public onActionTriggered?: (
    action:
      | 'inventory'
      | 'characterWheel'
      | 'wardrobe'
      | 'missions'
      | 'openMap'
      | 'pause'
      | 'weaponNext'
      | 'quickHeal'
      | 'quickArmor'
      | 'toggleDock'
      | 'phone'
  ) => void;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundPointerLockChange: () => void;
  private boundWheel: (e: WheelEvent) => void;

  constructor() {
    this.boundKeyDown = (e) => {
      if (this.paused) return;
      this.keysDown.add(e.code);

      if (e.code === this.getKeyBinding('inventory')) {
        e.preventDefault();
        this.onActionTriggered?.('inventory');
      } else if (e.code === this.getKeyBinding('characterWheel')) {
        e.preventDefault();
        this.onActionTriggered?.('characterWheel');
      } else if (e.code === this.getKeyBinding('wardrobe')) {
        e.preventDefault();
        this.onActionTriggered?.('wardrobe');
      } else if (e.code === this.getKeyBinding('missions')) {
        e.preventDefault();
        this.onActionTriggered?.('missions');
      } else if (e.code === this.getKeyBinding('openMap')) {
        e.preventDefault();
        this.onActionTriggered?.('openMap');
      } else if (e.code === this.getKeyBinding('toggleDock')) {
        e.preventDefault();
        this.onActionTriggered?.('toggleDock');
      } else if (e.code === this.getKeyBinding('phone')) {
        e.preventDefault();
        this.onActionTriggered?.('phone');
      } else if (e.code === 'Digit1') {
        this.onActionTriggered?.('quickHeal');
      } else if (e.code === 'Digit2') {
        this.onActionTriggered?.('quickArmor');
      } else if (e.code === 'KeyQ' && !this.inAircraft) {
        this.onActionTriggered?.('weaponNext');
      }
    };

    this.boundKeyUp = (e) => {
      this.keysDown.delete(e.code);
    };

    this.boundMouseDown = (e) => {
      if (this.paused) return;
      this.mouseButtonsDown.add(e.button);
      if (this.targetElement && document.pointerLockElement !== this.targetElement && e.target === this.targetElement) {
        this.requestPointerLock();
      }
    };

    this.boundMouseUp = (e) => {
      this.mouseButtonsDown.delete(e.button);
    };

    this.boundMouseMove = (e) => {
      if (this.paused) return;
      if (document.pointerLockElement === this.targetElement || this.mouseButtonsDown.has(2)) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    };

    this.boundContextMenu = (e) => {
      if (e.target === this.targetElement) {
        e.preventDefault();
      }
    };

    this.boundPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.targetElement;
    };

    this.boundWheel = (e) => {
      if (this.paused) return;
      if (Math.abs(e.deltaY) > 10) {
        this.onActionTriggered?.('weaponNext');
      }
    };
  }

  public attach(el: HTMLElement) {
    this.targetElement = el;
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('contextmenu', this.boundContextMenu);
    document.addEventListener('pointerlockchange', this.boundPointerLockChange);
    el.addEventListener('wheel', this.boundWheel, { passive: true });
  }

  public detach() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('contextmenu', this.boundContextMenu);
    document.removeEventListener('pointerlockchange', this.boundPointerLockChange);
    this.targetElement?.removeEventListener('wheel', this.boundWheel);
    this.targetElement = null;
  }

  public requestPointerLock() {
    if (this.targetElement && document.pointerLockElement !== this.targetElement) {
      this.targetElement.requestPointerLock?.();
    }
  }

  public exitPointerLock() {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  public updateSettings(settings: ControlSettings) {
    this.settings = structuredClone(settings);
  }

  public setControlCategory(cat: VehicleControlCategory) {
    this.controlCategory = cat;
  }

  private getKeyBinding(action: KeyAction): string {
    const override = this.settings.vehicleOverrides?.[this.controlCategory]?.keyBindings?.[action];
    return override || this.settings.keyBindings[action];
  }

  private getGamepadBinding(action: GamepadButtonAction): number {
    const override = this.settings.vehicleOverrides?.[this.controlCategory]?.gamepadBindings?.[action];
    return override !== undefined ? override : this.settings.gamepadBindings[action];
  }

  private getStickConfig(): StickControlConfig {
    const defPitchInvert = this.controlCategory === 'plane' || this.controlCategory === 'fighter_jet';
    const defYaw: StickControlConfig['yawSource'] =
      this.controlCategory === 'plane' ||
      this.controlCategory === 'fighter_jet' ||
      this.controlCategory === 'helicopter'
        ? 'bumpers'
        : 'left_x';
    const ov = this.settings.vehicleOverrides?.[this.controlCategory]?.stickConfig;
    return {
      moveStick: ov?.moveStick ?? 'left',
      pitchInvert: ov?.pitchInvert ?? defPitchInvert,
      yawSource: ov?.yawSource ?? defYaw,
    };
  }

  public clearKeys() {
    this.keysDown.clear();
    this.mouseButtonsDown.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  private isKeyBindingDown(action: KeyAction): boolean {
    const code = this.getKeyBinding(action);
    if (!code) return false;
    if (code === 'Mouse0') return this.mouseButtonsDown.has(0);
    if (code === 'Mouse1') return this.mouseButtonsDown.has(1);
    if (code === 'Mouse2') return this.mouseButtonsDown.has(2);
    return this.keysDown.has(code);
  }

  private getActiveGamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }

  public triggerVibration(durationMs: number, weakMagnitude: number, strongMagnitude: number) {
    if (!this.settings.vibration) return;
    const pad = this.getActiveGamepad();
    if (!pad) return;
    const actuator = pad.vibrationActuator as
      | { playEffect?: (type: string, params: Record<string, number>) => Promise<string> }
      | undefined;
    if (actuator?.playEffect) {
      actuator
        .playEffect('dual-rumble', {
          startDelay: 0,
          duration: durationMs,
          weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
          strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
        })
        .catch(() => {});
    }
  }

  private isGamepadButtonDown(pad: Gamepad | null, action: GamepadButtonAction): boolean {
    if (!pad) return false;
    const idx = this.getGamepadBinding(action);
    if (idx === undefined || idx < 0 || idx >= pad.buttons.length) return false;
    const btn = pad.buttons[idx];
    return btn.pressed || btn.value > 0.35;
  }

  private getGamepadTriggerValue(pad: Gamepad | null, action: GamepadButtonAction): number {
    if (!pad) return 0;
    const idx = this.getGamepadBinding(action);
    if (idx === undefined || idx < 0 || idx >= pad.buttons.length) return 0;
    return pad.buttons[idx].value ?? (pad.buttons[idx].pressed ? 1 : 0);
  }

  public poll(dt: number): InputFrameState {
    const pad = this.getActiveGamepad();
    const controllerConnected = Boolean(pad);
    const detectedType: 'playstation' | 'xbox' | 'none' = pad ? detectControllerType(pad.id) : 'none';
    const controllerType =
      this.settings.glyphMode === 'playstation'
        ? 'playstation'
        : this.settings.glyphMode === 'xbox'
          ? 'xbox'
          : detectedType;

    // Handle edge-triggered gamepad menu shortcuts even when paused/unpaused
    if (pad) {
      const checkPadEdge = (btnIdx: number): boolean => {
        if (btnIdx < 0 || btnIdx >= pad.buttons.length) return false;
        const down = Boolean(pad.buttons[btnIdx]?.pressed);
        const wasDown = this.prevGamepadButtons.get(btnIdx) ?? false;
        this.prevGamepadButtons.set(btnIdx, down);
        return down && !wasDown;
      };

      if (checkPadEdge(this.getGamepadBinding('pause'))) {
        this.onActionTriggered?.('pause');
      }
      if (!this.paused) {
        if (!this.inAircraft && checkPadEdge(this.getGamepadBinding('inventory'))) {
          this.onActionTriggered?.('inventory');
        }
        if (!this.inAircraft && checkPadEdge(this.getGamepadBinding('characterWheel'))) {
          this.onActionTriggered?.('characterWheel');
        }
        if (checkPadEdge(this.getGamepadBinding('openMap'))) {
          this.onActionTriggered?.('openMap');
        }
        if (checkPadEdge(this.getGamepadBinding('toggleDock'))) {
          this.onActionTriggered?.('toggleDock');
        }
        const phoneBtn = this.getGamepadBinding('phone');
        const mapBtn = this.getGamepadBinding('openMap');
        const dockBtn = this.getGamepadBinding('toggleDock');
        if (checkPadEdge(phoneBtn)) {
          this.onActionTriggered?.('phone');
        }
        // Quick heal / armor / weapon cycle only on unbound D-pad directions so nothing collides with GTA 5 phone (D-pad Up 12)
        if (phoneBtn !== 13 && checkPadEdge(13)) this.onActionTriggered?.('quickArmor');
        if (phoneBtn !== 12 && checkPadEdge(12)) this.onActionTriggered?.('quickHeal');
        if (mapBtn !== 15 && dockBtn !== 15 && checkPadEdge(15)) {
          this.onActionTriggered?.('weaponNext');
        }
      }
    }

    const stickConfig = this.getStickConfig();

    if (this.paused) {
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      return {
        moveX: 0,
        moveY: 0,
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
        padLeftStickX: 0,
        padLeftStickY: 0,
        padRightStickX: 0,
        padRightStickY: 0,
        lookDeltaX: 0,
        lookDeltaY: 0,
        throttle: 0,
        brake: 0,
        sprint: false,
        jumpPressed: false,
        jumpHeld: false,
        handbrakeHeld: false,
        shootHeld: false,
        shootPressed: false,
        aimHeld: false,
        reloadPressed: false,
        enterVehiclePressed: false,
        carjackPressed: false,
        switchCameraPressed: false,
        hornHeld: false,
        l1Held: false,
        r1Held: false,
        l3Pressed: false,
        pitchUpHeld: false,
        pitchDownHeld: false,
        stickConfig,
        controllerConnected,
        controllerType,
        controllerName: pad?.id || '',
      };
    }

    const dz = this.settings.deadzone;
    const applyDz = (val: number) => {
      if (Math.abs(val) < dz) return 0;
      return (Math.sign(val) * (Math.abs(val) - dz)) / (1 - dz);
    };

    // Movement axes
    let moveX = (this.isKeyBindingDown('moveRight') ? 1 : 0) - (this.isKeyBindingDown('moveLeft') ? 1 : 0);
    let moveY = (this.isKeyBindingDown('moveForward') ? 1 : 0) - (this.isKeyBindingDown('moveBackward') ? 1 : 0);
    if (this.keysDown.has('ArrowRight')) moveX = Math.max(moveX, 1);
    if (this.keysDown.has('ArrowLeft')) moveX = Math.min(moveX, -1);

    let leftStickX = moveX;
    let leftStickY = moveY;
    let rightStickX = 0;
    let rightStickY = 0;
    let padLeftStickX = 0;
    let padLeftStickY = 0;
    let padRightStickX = 0;
    let padRightStickY = 0;

    if (pad && pad.axes.length >= 2) {
      const lx = applyDz(pad.axes[0]);
      const ly = applyDz(-pad.axes[1]); // up = +1, down = -1
      padLeftStickX = lx;
      padLeftStickY = ly;
    }

    // Look delta
    const ySign = this.settings.invertY ? -1 : 1;
    let lookDeltaX = this.mouseDeltaX * 0.0024 * this.settings.mouseSensitivity;
    let lookDeltaY = this.mouseDeltaY * 0.0024 * this.settings.mouseSensitivity * ySign;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    if (pad && pad.axes.length >= 4) {
      const rx = applyDz(pad.axes[2]);
      const ry = applyDz(pad.axes[3]);
      padRightStickX = rx;
      padRightStickY = -ry; // up = +1, down = -1
      rightStickX = rx;
      rightStickY = -ry;
    }

    // Apply per-vehicle primary stick selection (left vs right stick for movement/steering)
    const activeAnalogX = stickConfig.moveStick === 'right' ? padRightStickX : padLeftStickX;
    const activeAnalogY = stickConfig.moveStick === 'right' ? padRightStickY : padLeftStickY;
    const camStickX = stickConfig.moveStick === 'right' ? padLeftStickX : padRightStickX;
    const camStickY = stickConfig.moveStick === 'right' ? -padLeftStickY : -padRightStickY;

    if (Math.abs(activeAnalogX) > Math.abs(moveX)) moveX = activeAnalogX;
    if (Math.abs(activeAnalogY) > Math.abs(moveY)) moveY = activeAnalogY;
    if (Math.abs(padLeftStickX) > Math.abs(leftStickX)) leftStickX = padLeftStickX;
    if (Math.abs(padLeftStickY) > Math.abs(leftStickY)) leftStickY = padLeftStickY;

    if (!this.inAircraft || stickConfig.moveStick === 'left') {
      lookDeltaX += camStickX * 2.6 * this.settings.gamepadSensitivity * dt;
      lookDeltaY += camStickY * 2.1 * this.settings.gamepadSensitivity * dt * ySign;
    }

    // Triggers & Actions
    const r2Val = this.getGamepadTriggerValue(pad, 'shoot');
    const l2Val = this.getGamepadTriggerValue(pad, 'aim');

    const throttle = Math.max(this.isKeyBindingDown('moveForward') ? 1 : 0, r2Val);
    const brake = Math.max(this.isKeyBindingDown('moveBackward') ? 1 : 0, l2Val);

    const l3Down = Boolean(pad && pad.buttons[10]?.pressed);
    const sprint =
      this.isKeyBindingDown('sprint') ||
      this.isGamepadButtonDown(pad, 'sprint') ||
      (this.controlCategory === 'foot' && l3Down);
    const jumpHeld = this.isKeyBindingDown('jump') || this.isGamepadButtonDown(pad, 'jump');
    const handbrakeHeld = jumpHeld || (this.controlCategory === 'car' || this.controlCategory === 'motorcycle' ? Boolean(pad && pad.buttons[5]?.pressed) : false);
    const shootHeld = this.isKeyBindingDown('shoot') || (this.getGamepadBinding('shoot') === 7 ? r2Val > 0.4 : this.isGamepadButtonDown(pad, 'shoot'));
    const aimHeld = this.isKeyBindingDown('aim') || l2Val > 0.4;
    const reloadDown = this.isKeyBindingDown('reload') || this.isGamepadButtonDown(pad, 'reload');
    const enterDown = this.isKeyBindingDown('enterVehicle') || this.isGamepadButtonDown(pad, 'enterVehicle');
    const l1Held = Boolean(pad && pad.buttons[4]?.pressed) || this.keysDown.has('KeyQ');
    const r1Held = Boolean(pad && pad.buttons[5]?.pressed) || this.keysDown.has('KeyE');
    const shiftHeld = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
    const carjackModifier = shiftHeld || Boolean(pad && pad.buttons[4]?.pressed);
    const dedicatedCarjackDown = this.keysDown.has('KeyG');

    const camPadBtn = this.getGamepadBinding('switchCamera');
    const camDown =
      this.isKeyBindingDown('switchCamera') ||
      this.isGamepadButtonDown(pad, 'switchCamera') ||
      (camPadBtn === 17 && Boolean(pad && pad.buttons[8]?.pressed));
    const hornHeld = this.isKeyBindingDown('horn') || l3Down;

    const pitchUpHeld = this.keysDown.has('ArrowUp');
    const pitchDownHeld = this.keysDown.has('ArrowDown');

    const edge = (name: string, down: boolean): boolean => {
      const was = this.prevActions.has(name);
      if (down) this.prevActions.add(name);
      else this.prevActions.delete(name);
      return down && !was;
    };

    const enterVehiclePressed = edge('enter', enterDown);
    const carjackPressed =
      (enterVehiclePressed && carjackModifier) || edge('carjack_key', dedicatedCarjackDown);

    return {
      moveX: Math.max(-1, Math.min(1, moveX)),
      moveY: Math.max(-1, Math.min(1, moveY)),
      leftStickX: Math.max(-1, Math.min(1, leftStickX)),
      leftStickY: Math.max(-1, Math.min(1, leftStickY)),
      rightStickX: Math.max(-1, Math.min(1, rightStickX)),
      rightStickY: Math.max(-1, Math.min(1, rightStickY)),
      padLeftStickX: Math.max(-1, Math.min(1, padLeftStickX)),
      padLeftStickY: Math.max(-1, Math.min(1, padLeftStickY)),
      padRightStickX: Math.max(-1, Math.min(1, padRightStickX)),
      padRightStickY: Math.max(-1, Math.min(1, padRightStickY)),
      lookDeltaX,
      lookDeltaY,
      throttle,
      brake,
      sprint,
      jumpPressed: edge('jump', jumpHeld),
      jumpHeld,
      handbrakeHeld,
      shootHeld,
      shootPressed: edge('shoot', shootHeld),
      aimHeld,
      reloadPressed: edge('reload', reloadDown),
      enterVehiclePressed,
      carjackPressed,
      switchCameraPressed: edge('cam', camDown),
      hornHeld,
      l1Held,
      r1Held,
      l3Pressed: edge('l3', l3Down),
      pitchUpHeld,
      pitchDownHeld,
      stickConfig,
      controllerConnected,
      controllerType,
      controllerName: pad?.id || '',
    };
  }
}
