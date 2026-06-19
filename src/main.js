import * as THREE from 'three';
import './style.css';
import { createGrid } from './grid.js';
import { setupEnvironment } from './environment.js';
import { CameraController } from './camera.js';

/**
 * RennenSP — Main Entry Point
 * 
 * Initializes the Three.js renderer, scene, camera,
 * and wires up the grid, environment, and camera controller.
 */

// DOM elements
const canvas = document.getElementById('render-canvas');
const loadingScreen = document.getElementById('loading-screen');
const loaderFill = document.getElementById('loader-fill');
const hudOverlay = document.getElementById('hud-overlay');
const speedValue = document.getElementById('speed-value');
const posX = document.getElementById('pos-x');
const posZ = document.getElementById('pos-z');

// ============================================
// Renderer
// ============================================
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

// ============================================
// Scene
// ============================================
const scene = new THREE.Scene();

// ============================================
// Camera
// ============================================
const camera = new THREE.PerspectiveCamera(
  65,                                       // FOV
  window.innerWidth / window.innerHeight,   // aspect
  0.1,                                      // near
  15000                                     // far — covers the 20km world
);
camera.position.set(0, 5, 10);

// ============================================
// Initialize scene content
// ============================================

// Loading simulation
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
  // Setup grid
  const grid = createGrid();
  scene.add(grid);

  // Setup environment (sky, lights, fog)
  setupEnvironment(scene);

  // Add reference objects so the grid doesn't feel empty
  addReferenceObjects(scene);

  // Camera controller
  const cameraController = new CameraController(camera, canvas);

  // Finish loading
  await simulateLoading();
  loadingScreen.classList.add('hidden');
  hudOverlay.classList.add('visible');

  // Start render loop
  const clock = new THREE.Clock();
  
  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05); // cap delta to avoid jumps

    // Update camera
    cameraController.update(dt);

    // Update HUD
    const speed = cameraController.getSpeed();
    speedValue.textContent = speed.toFixed(1);
    posX.textContent = `X: ${camera.position.x.toFixed(1)}`;
    posZ.textContent = `Z: ${camera.position.z.toFixed(1)}`;

    // Render
    renderer.render(scene, camera);
  }

  animate();
}

// ============================================
// Reference objects — visual landmarks
// ============================================
function addReferenceObjects(scene) {
  // Create a few pylons/cones to give a sense of scale and place
  const coneMaterial = new THREE.MeshStandardMaterial({
    color: 0xdd4400,
    roughness: 0.6,
    metalness: 0.1,
  });
  const coneStripe = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    roughness: 0.7,
    metalness: 0.0,
  });

  const coneGeometry = new THREE.ConeGeometry(0.3, 0.8, 8);
  const coneBaseGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 8);

  const conePositions = [
    [3, 0, -5],
    [-3, 0, -5],
    [3, 0, -15],
    [-3, 0, -15],
    [3, 0, -25],
    [-3, 0, -25],
    [0, 0, -35],
    [6, 0, -10],
    [-6, 0, -10],
    [6, 0, -20],
    [-6, 0, -20],
  ];

  conePositions.forEach(([x, y, z]) => {
    // Cone body
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.set(x, y + 0.4, z);
    cone.castShadow = true;
    cone.receiveShadow = true;
    scene.add(cone);

    // Cone base
    const base = new THREE.Mesh(coneBaseGeometry, coneStripe);
    base.position.set(x, y + 0.025, z);
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);
  });

  // Starting line — white dashed stripe
  const lineGeometry = new THREE.PlaneGeometry(0.8, 0.15);
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    emissive: 0x333333,
  });

  for (let i = -5; i <= 5; i++) {
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * 1.2, 0.005, -5);
    scene.add(line);
  }

  // Tire stacks at corners — sim racing atmosphere
  const tireGeometry = new THREE.TorusGeometry(0.35, 0.15, 8, 16);
  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.95,
    metalness: 0.0,
  });

  const tirePositions = [
    [8, 0.35, -2],
    [8, 0.35, -3],
    [8, 0.65, -2.5],
    [-8, 0.35, -2],
    [-8, 0.35, -3],
    [-8, 0.65, -2.5],
  ];

  tirePositions.forEach(([x, y, z]) => {
    const tire = new THREE.Mesh(tireGeometry, tireMaterial);
    tire.position.set(x, y, z);
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    tire.receiveShadow = true;
    scene.add(tire);
  });
}

// ============================================
// Resize handler
// ============================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================
// Start
// ============================================
init();
