import * as THREE from 'three';
import './style.css';
import { setupEnvironment } from './environment.js';
import { SimVehicleCameraManager } from './camera.js';
import { UniversalInputManager } from './input.js';
import { SimpleRaycastVehicle } from './vehicle.js';
import { TrackGenerator } from './TrackGenerator.js';

// Global variables accessible everywhere
let vehicle;
let trackGenerator;
let trackCurve; // Global variable reference for the spline trajectory curve

// DOM elements
const canvas = document.getElementById('render-canvas');
const loadingScreen = document.getElementById('loading-screen');
const loaderFill = document.getElementById('loader-fill');
const hudOverlay = document.getElementById('hud-overlay');
const speedValue = document.getElementById('speed-value');
const posX = document.getElementById('pos-x');
const posY = document.getElementById('pos-y');
const posZ = document.getElementById('pos-z');

const hudDashboard = document.getElementById('hud-dashboard');
const gearValue = document.getElementById('gear-value');
const rpmBarFill = document.getElementById('rpm-bar-fill');
const rpmValue = document.getElementById('rpm-value');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 6000);
camera.position.set(0, 5, 10);

let loadProgress = 0;
function simulateLoading() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      loadProgress += Math.random() * 15 + 5;
      if (loadProgress >= 100) {
        loadProgress = 100;
        loaderFill.style.width = '100%';
        clearInterval(interval);
        setTimeout(resolve, 300);
      } else {
        loaderFill.style.width = `${loadProgress}%`;
      }
    }, 120);
  });
}

async function init() {
  setupEnvironment(scene);

  const cameraManager = new SimVehicleCameraManager(camera, {
    followDistance: 8.0,
    followHeight: 3.5,
    lookAheadDistance: 1.5,
    positionSmoothing: 5.0,
    lookAtSmoothing: 5.0,
    baseFOV: 65,
    maxFOV: 78,
    maxSpeedForFOV: 65,
    minHeight: 0.8,
  });

  const inputManager = new UniversalInputManager({
    deadzone: 0.05,
    steeringSensitivity: 8,
    autoCenterKey: 'KeyC',
    showOverlay: true,
  });

  // ========================================================
  // 📥 LOCAL CONFIGURATION & ASSET PIPELINE LOADER
  // ========================================================
  const trackConfig = {
    name: "Red Bull Ring",
    spawnPoint: { x: 0, y: 0, z: 0 } // This will be overwritten by our road mesh detector
  };

  let trackLoadPromise = Promise.resolve();
  try {
    trackLoadPromise = new Promise((resolve) => {
      trackGenerator = new TrackGenerator(scene, resolve);
    });
    trackCurve = trackGenerator.curve;
    console.log("Successfully loaded local circuit configuration: " + trackConfig.name);

    // 🏎️ SPAWN CAR SAFELY ON THE REAL ASYNCHRONOUS TRACK CORE LINE
    const REVENUE_SPAWN = { x: 432.6, y: -41.2, z: 160.1 };
    
    // Find closest t on the trackCurve
    const testPoint = new THREE.Vector3(REVENUE_SPAWN.x, REVENUE_SPAWN.y, REVENUE_SPAWN.z);
    let minD2 = Infinity;
    let closestT = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const pt = trackCurve.getPointAt(t);
      const d2 = pt.distanceToSquared(testPoint);
      if (d2 < minD2) {
        minD2 = d2;
        closestT = t;
      }
    }

    const spawnPoint = trackCurve.getPointAt(closestT);
    const nextT = (closestT + 0.005) % 1.0;
    const nextPoint = trackCurve.getPointAt(nextT);
    const direction = new THREE.Vector3().subVectors(nextPoint, spawnPoint).normalize();
    
    vehicle = new SimpleRaycastVehicle(scene, new THREE.Vector3(REVENUE_SPAWN.x, REVENUE_SPAWN.y + 2.0, REVENUE_SPAWN.z));
    window.vehicle = vehicle;
    
    const headingAngle = Math.atan2(direction.x, direction.z);
    vehicle.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingAngle);
    vehicle.mesh.quaternion.copy(vehicle.orientation);
    if (vehicle.velocity) vehicle.velocity.set(0, 0, 0);

    // Wake up physics / gravity on user interaction
    const wakePhysics = (e) => {
      if (vehicle && !vehicle.gravityEnabled) {
        if (e && e.type === 'keydown') {
          if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'KeyG') {
            return;
          }
        }
        vehicle.gravityEnabled = true;
      }
    };
    window.addEventListener('keydown', wakePhysics);
    window.addEventListener('mousedown', wakePhysics);

  } catch (error) {
    console.error("Critical Failure running asset data pipeline: ", error);
  }

  await simulateLoading();
  await trackLoadPromise;
  loadingScreen.classList.add('hidden');
  hudOverlay.classList.add('visible');

  const clock = new THREE.Clock();
  const carPos = new THREE.Vector3();
  const closestPoint = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3(0, -1, 0);
  
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    inputManager.update(dt);

    // ========================================================
    // 🏁 VARIABLE-WIDTH DISTANCE & COLLISION TRACKING
    // ========================================================
    if (trackCurve && trackGenerator && vehicle && vehicle.mesh) {
      carPos.copy(vehicle.mesh.position);
      
      // Compute the absolute square distance to closest coordinate on track spine line
      const trackDistanceSq = trackGenerator.findClosestPointToPoint(carPos, closestPoint);
      const actualDistance = Math.sqrt(trackDistanceSq);

      // Find out exactly where we are along the spline parameter scale (0.0 to 1.0)
      // We calculate parameter 't' dynamically by evaluating the closest index node 
      let minD2 = Infinity;
      let closestIdx = 0;
      const pts = trackGenerator.sampledPoints;
      for (let k = 0; k < pts.length; k++) {
        const d2 = carPos.distanceToSquared(pts[k]);
        if (d2 < minD2) { minD2 = d2; closestIdx = k; }
      }
      const localT = closestIdx / pts.length;

      // Extract localized width limits for this specific track cross-section coordinate slice
      const currentTrackWidth = trackGenerator._getTrackWidthAt(localT, trackGenerator.widthsData.length);
      const currentRadius = currentTrackWidth / 2;

      // Calculate Wall boundary zones dynamically relative to localized width parameters
      const wallBound = currentRadius + 3.0;
      const wallThreshold = wallBound - 1.2;

      // 1. Dynamic Off-Track Traction Penalties
      vehicle.isOffTrack = (actualDistance > currentRadius);
      vehicle.maxAccelerationScale = vehicle.isOffTrack ? 0.35 : 1.0;

      // 2. Dynamic Solid Variable-Width Concrete Barrier Collisions (Disabled to prevent invisible walls)
      /*
      if (actualDistance >= wallThreshold) {
        const pushDirection = new THREE.Vector3().subVectors(closestPoint, carPos).normalize();
        pushDirection.y = 0; 

        // Snap the chassis structure smoothly inside dynamic layout clearance lines
        vehicle.mesh.position.copy(closestPoint).addScaledVector(pushDirection, -wallThreshold + 0.1);
        
        if (vehicle.velocity) {
          const dot = vehicle.velocity.dot(pushDirection);
          if (dot < 0) {
            vehicle.velocity.addScaledVector(pushDirection, -1.1 * dot);
          }
        }
      }
      */

      // 3. Simple Elevation Matcher (Locks vehicle height profile to the Austrian hills)
      if (!vehicle.isOffTrack) {
         vehicle.mesh.position.y = THREE.MathUtils.lerp(vehicle.mesh.position.y, closestPoint.y + 0.4, 0.2);
      }
    }

    vehicle.update(dt, inputManager, trackGenerator);

    // Perform downward raycast to find true track elevation and clamp vehicle altitude
    if (trackGenerator && trackGenerator.trackMesh && vehicle && vehicle.gravityEnabled) {
      rayOrigin.set(vehicle.position.x, vehicle.position.y + 10, vehicle.position.z);
      raycaster.set(rayOrigin, rayDirection);
      const intersects = raycaster.intersectObjects([trackGenerator.trackMesh], true);
      if (intersects.length > 0) {
        const targetGroundY = intersects[0].point.y;
        if (vehicle.physicsBody) {
          vehicle.physicsBody.position.y = targetGroundY + 0.1;
        } else {
          vehicle.position.y = targetGroundY + 0.1;
          vehicle.mesh.position.y = vehicle.position.y;
        }
      }
    }

    cameraManager.update(dt, vehicle.mesh, vehicle.velocity);

    // UI Updates
    const speedKmh = vehicle.getSpeedKmh();
    speedValue.textContent = speedKmh.toFixed(0);

    if (gearValue) gearValue.textContent = vehicle.getGearName();

    if (rpmValue && rpmBarFill) {
      rpmValue.textContent = Math.round(vehicle.rpm).toLocaleString();
      const rpmPct = Math.min(Math.max((vehicle.rpm / vehicle.maxRPM) * 100, 0), 100);
      rpmBarFill.style.width = `${rpmPct}%`;
    }

    if (hudDashboard) {
      if (vehicle.rpm >= (vehicle.maxRPM - 1000)) { // Dynamic critical flashing limit
        hudDashboard.classList.add('rpm-critical-flash');
      } else {
        hudDashboard.classList.remove('rpm-critical-flash');
      }
    }

    const vPos = vehicle.getPosition();
    if (posX) posX.textContent = `X: ${vPos.x.toFixed(1)}`;
    if (posY) posY.textContent = `Y: ${vPos.y.toFixed(1)}`;
    if (posZ) posZ.textContent = `Z: ${vPos.z.toFixed(1)}`;

    renderer.render(scene, camera);
  }

  animate();
}

function addReferenceObjects(scene) {}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') { 
    if (vehicle) {
      console.log("--- 🏎️ QUICK DIAGNOSTIC LOG ---");
      console.log(`POS: X: ${vehicle.mesh.position.x.toFixed(2)}, Z: ${vehicle.mesh.position.z.toFixed(2)}`);
      console.log(`SPEED: ${vehicle.getSpeedKmh().toFixed(0)} KM/H | RPM: ${Math.round(vehicle.rpm)}`);
      console.log(`OFF-TRACK PENALTY ACTIVE: ${vehicle.isOffTrack}`);
    }
  }
});

init();