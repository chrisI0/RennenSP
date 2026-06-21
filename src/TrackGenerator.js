import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const TRACK_URL = "/redbull_ring.glb";

export class TrackGenerator {
  constructor(scene, onLoadCallback) {
    this.scene = scene;
    
    // 1. Mathematically construct the authentic Z-axis aligned Red Bull Ring path vectors
    const controlPoints = [
      new THREE.Vector3(0, -54.0, 0),         // 0: Start Line (Straight 1)
      new THREE.Vector3(0, -54.0, -325),      // 1: Mid Straight 1
      new THREE.Vector3(0, -54.0, -650),      // 2: Turn 1 Entry (Niki Lauda Kurve)
      new THREE.Vector3(20, -51.5, -680),   // 3: Turn 1 Apex Climb
      new THREE.Vector3(60, -49.0, -650),   // 4: Turn 1 Exit / Remus Straight Entry
      new THREE.Vector3(200, -43.85, -500), // 5: Remus Straight Uphill
      new THREE.Vector3(400, -38.1, -350),  // 6: Remus Straight Uphill
      new THREE.Vector3(600, -32.35, -200), // 7: Remus Straight Uphill
      new THREE.Vector3(800, -26.6, -50),   // 8: Remus Straight Uphill
      new THREE.Vector3(820, -26.0, -20),   // 9: Turn 3 Hairpin Entry (Remus)
      new THREE.Vector3(840, -26.0, 10),    // 10: Turn 3 Apex (highest altitude Y=-26)
      new THREE.Vector3(820, -27.0, 40),    // 11: Turn 3 Exit downhill
      new THREE.Vector3(650, -32.0, 20),    // 12: Straight 3 Downhill
      new THREE.Vector3(480, -37.0, 0),     // 13: Turn 4 Entry (Rauch)
      new THREE.Vector3(430, -39.0, -10),   // 14: Turn 4 Apex (Rauch left turn)
      new THREE.Vector3(410, -41.0, 40),    // 15: Turn 4 Exit
      new THREE.Vector3(300, -44.0, 100),   // 16: Turn 5 (Infield fast sweeper)
      new THREE.Vector3(200, -47.0, 150),   // 17: Turn 6 (Infield fast sweeper)
      new THREE.Vector3(100, -49.0, 200),   // 18: Turn 7 (Infield fast sweeper)
      new THREE.Vector3(20, -51.0, 150),    // 19: Turn 8 downhill
      new THREE.Vector3(-50, -53.0, 80),    // 20: Turn 9 (Jochen Rindt right turn)
      new THREE.Vector3(-30, -54.0, 20)     // 21: Turn 10 (Red Bull Mobile right turn)
    ];

    const controlWidths = [
      15.0, 15.0, 15.0, 13.0, 12.0, 13.0, 13.0, 13.0, 13.0, 11.0, 
      11.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 13.0, 14.0, 15.0
    ];

    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal');
    this.sampledPoints = this.curve.getSpacedPoints(400);

    // Dynamic width interpolation data
    this.widthsData = [];
    const pCount = controlPoints.length;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const rawIndex = t * (pCount - 1);
      const baseIdx = Math.floor(rawIndex);
      const nextIdx = (baseIdx + 1) % pCount;
      const alpha = rawIndex - baseIdx;
      const w0 = controlWidths[baseIdx];
      const w1 = controlWidths[nextIdx];
      this.widthsData.push(THREE.MathUtils.lerp(w0, w1, alpha));
    }

    this._ab = new THREE.Vector3();
    this._ap = new THREE.Vector3();
    this._outA = new THREE.Vector3();
    this._outB = new THREE.Vector3();

    // 2. Load the 3D model GLTF asset from cloud storage
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load(TRACK_URL, (gltf) => {
      this.trackMesh = gltf.scene;
      
      const statusText = document.getElementById('loading-status-text');
      if (statusText) {
        statusText.textContent = "Unpacking and configuring 3D environment...";
      }

      // Cache the road mesh node to enable high-speed visual-to-physics alignment
      this.roadMesh = null;
      gltf.scene.traverse((node) => {
        if (node.isMesh && node.name.toUpperCase().includes("ROAD")) {
          this.roadMesh = node;
        }
      });
      if (!this.roadMesh) {
        gltf.scene.traverse((node) => {
          if (node.isMesh && !this.roadMesh) {
            this.roadMesh = node;
          }
        });
      }
      
      this.scene.add(this.trackMesh);
      this.trackMesh.updateMatrixWorld(true);

      // Yield to browser frame rates before calling load callback
      setTimeout(() => {
        console.log("3D Environment model loaded successfully!");
        
        if (statusText) {
          statusText.textContent = "Loading complete! Press any key or click to start.";
        }
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
          progressBar.style.width = '100%';
        }
        
        // Trigger callback so main.js knows the map is ready
        if (onLoadCallback) onLoadCallback(gltf);
      }, 100);
    }, 
    (xhr) => {
      if (xhr.total) {
        const percent = (xhr.loaded / xhr.total) * 100;
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
          progressBar.style.width = `${percent.toFixed(0)}%`;
        }
        const statusText = document.getElementById('loading-status-text');
        if (statusText) {
          statusText.textContent = `Downloading track assets: ${percent.toFixed(0)}% (${(xhr.loaded / 1024 / 1024).toFixed(1)} MB / ${(xhr.total / 1024 / 1024).toFixed(1)} MB)`;
        }
      }
    },
    (error) => console.error("Error loading 3D map asset:", error));
  }

  _getTrackWidthAt(t, rawPointsCount) {
    const rawIndex = t * 400;
    const baseIdx = Math.floor(rawIndex);
    const nextIdx = (baseIdx + 1) % 401;
    const alpha = rawIndex - baseIdx;
    return THREE.MathUtils.lerp(this.widthsData[baseIdx], this.widthsData[nextIdx], alpha);
  }

  findClosestPointToPoint(point, outPoint) {
    let minD2 = Infinity;
    let closestIdx = 0;
    const pts = this.sampledPoints;
    const n = pts.length;

    for (let i = 0; i < n; i++) {
      const d2 = point.distanceToSquared(pts[i]);
      if (d2 < minD2) {
        minD2 = d2;
        closestIdx = i;
      }
    }

    const idxPrev = (closestIdx - 1 + n) % n;
    const idxNext = (closestIdx + 1) % n;

    const distSqA = this._projectOnSegment(point, pts[idxPrev], pts[closestIdx], this._outA);
    const distSqB = this._projectOnSegment(point, pts[closestIdx], pts[idxNext], this._outB);

    if (distSqA < distSqB) {
      outPoint.copy(this._outA);
      return distSqA;
    } else {
      outPoint.copy(this._outB);
      return distSqB;
    }
  }

  _projectOnSegment(p, a, b, out) {
    this._ab.subVectors(b, a);
    this._ap.subVectors(p, a);
    let t = this._ap.dot(this._ab) / this._ab.lengthSq();
    t = Math.max(0, Math.min(1, t));
    out.copy(a).addScaledVector(this._ab, t);
    return p.distanceToSquared(out);
  }
}