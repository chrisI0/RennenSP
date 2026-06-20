import * as THREE from 'three';
import './style.css';
import { createGrid } from './grid.js';
import { setupEnvironment } from './environment.js';
import { SimVehicleCameraManager } from './camera.js';
import { UniversalInputManager } from './input.js';
import { SimpleRaycastVehicle } from './vehicle.js';
import { TrackGenerator } from './TrackGenerator.js';

// Global variables accessible everywhere
let vehicle;
let trackGenerator;

// DOM elements
const canvas = document.getElementById('render-canvas');
const loadingScreen = document.getElementById('loading-screen');
const loaderFill = document.getElementById('loader-fill');
const hudOverlay = document.getElementById('hud-overlay');
const speedValue = document.getElementById('speed-value');
const posX = document.getElementById('pos-x');
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
  const grid = createGrid();
  scene.add(grid);

  setupEnvironment(scene);

  // Initialize track generator globally without a local 'const'
  trackGenerator = new TrackGenerator(scene);
  const trackCurve = trackGenerator.curve;

  addReferenceObjects(scene);

  const cameraManager = new SimVehicleCameraManager(camera, {
    followDistance: 6.0,
    followHeight: 2.2,
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
    autoCenterKey: 'Space',
    showOverlay: true,
  });

  // Assign instance to global variable cleanly
  vehicle = new SimpleRaycastVehicle(scene, new THREE.Vector3(0, 2, 0));
  vehicle.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  vehicle.mesh.quaternion.copy(vehicle.orientation);

  await simulateLoading();
  loadingScreen.classList.add('hidden');
  hudOverlay.classList.add('visible');

  const clock = new THREE.Clock();
  const carPos = new THREE.Vector3();
  const closestPoint = new THREE.Vector3();
  
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    inputManager.update(dt);

    // ========================================================
    // 🏁 TRACK DISTANCE & HARD WALL COLLISION MANAGMENT
    // ========================================================
    if (trackCurve && trackGenerator && vehicle && vehicle.mesh) {
      carPos.copy(vehicle.mesh.position);
      
      // Calculate zero-allocation squared distance to track center spline
      const trackDistanceSq = trackGenerator.findClosestPointToPoint(carPos, closestPoint);
      
      // 1. Off-Track Traction Friction Penalty (6 meters squared is 36.0)
      vehicle.isOffTrack = (trackDistanceSq > 36.0);
      vehicle.maxAccelerationScale = vehicle.isOffTrack ? 0.35 : 1.0;

      // 2. Solid Outer Concrete Wall Collision Check (Wall sits at 8.0m, checking at 6.8m threshold)
      if (trackDistanceSq >= 46.24) {
        // Calculate the push-back normal direction pointing inward toward the track center
        const pushDirection = new THREE.Vector3().subVectors(closestPoint, carPos).normalize();
        pushDirection.y = 0; // Lock to ground horizon coordinate plane

        // Mathematically snap the vehicle mesh position back to exactly 6.7 meters from the center spline
        vehicle.mesh.position.copy(closestPoint).addScaledVector(pushDirection, -6.7);
        
        // Reflect only the normal velocity component pointing toward the wall with a minor 0.1 scale dampening factor
        if (vehicle.velocity) {
          const dot = vehicle.velocity.dot(pushDirection);
          if (dot < 0) {
            vehicle.velocity.addScaledVector(pushDirection, -1.1 * dot);
          }
        }
      }
    }

    vehicle.update(dt, inputManager);
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
      if (vehicle.rpm >= 14000) {
        hudDashboard.classList.add('rpm-critical-flash');
      } else {
        hudDashboard.classList.remove('rpm-critical-flash');
      }
    }

    const vPos = vehicle.getPosition();
    posX.textContent = `X: ${vPos.x.toFixed(1)}`;
    posZ.textContent = `Z: ${vPos.z.toFixed(1)}`;

    renderer.render(scene, camera);
  }

  animate();
}

function addReferenceObjects(scene) {
  // Landmark cones commented out to keep the track clean
  /*
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0xdd4400, roughness: 0.6 });
  const coneGeometry = new THREE.ConeGeometry(0.3, 0.8, 8);
  const conePositions = [[3, 0, -5], [-3, 0, -5], [3, 0, -25], [-3, 0, -25]];
  conePositions.forEach(([x, y, z]) => {
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.set(x, y + 0.4, z);
    scene.add(cone);
  });
  */
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================
// Telemetry Clipboard Listener
// ============================================
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