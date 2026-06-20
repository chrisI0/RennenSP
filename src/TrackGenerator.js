import * as THREE from 'three';

export class TrackGenerator {
  constructor(scene) {
    this.scene = scene;
    this.trackWidth = 12;
    this.trackRadius = this.trackWidth / 2;
    this.wallRadius = 8.0; // Distance from center to the concrete barriers

    // 1. Core circuit loop points
    const trackPoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(120, 0, 0),
      new THREE.Vector3(260, 0, 50),
      new THREE.Vector3(300, 0, 180),
      new THREE.Vector3(200, 0, 300),
      new THREE.Vector3(80, 0, 320),
      new THREE.Vector3(0, 0, 280),
      new THREE.Vector3(40, 0, 200),
      new THREE.Vector3(120, 0, 150),
      new THREE.Vector3(60, 0, 90),
      new THREE.Vector3(-100, 0, 80),
      new THREE.Vector3(-180, 0, 20),
    ];

    this.curve = new THREE.CatmullRomCurve3(trackPoints, true, 'centripetal');
    this.sampledPoints = this.curve.getSpacedPoints(400); // Higher subdivisions for smoother walls

    // Pre-allocated lookup tools
    this._ab = new THREE.Vector3();
    this._ap = new THREE.Vector3();
    this._outA = new THREE.Vector3();
    this._outB = new THREE.Vector3();

    // 2. Generate Detailed Track Layers
    this.roadMesh = this._buildTrackSystem();
    this.scene.add(this.roadMesh);

    // 3. Generate 3D Solid Concrete Barriers
    this.wallMesh = this._buildConcreteWalls();
    this.scene.add(this.wallMesh);
  }

  /**
   * Compiles asphalt, white lines, and alternating red/white kerbs into a single optimized geometry block
   */
  _buildTrackSystem() {
    const segments = 400;
    const vertices = [];
    const colors = [];
    const indices = [];
    const UP = new THREE.Vector3(0, 1, 0);

    let vertexIdx = 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

      // Check track curvature to determine where to place alternating apex kerbs
      // We alternate colors based on the segment index `i` to create the checkerboard pattern
      const isKerbSegment = (i > 40 && i < 110) || (i > 150 && i < 280); 
      const isRed = (Math.floor(i / 3) % 2 === 0);

      const kerbColor = isRed ? new THREE.Color(0xd32f2f) : new THREE.Color(0xffffff);
      const whiteLineColor = new THREE.Color(0xeeeeee);
      const asphaltColor = new THREE.Color(0x18181b);

      // Define cross section profile nodes across the 12m track profile
      // [-KerbOuter, -TrackEdge, -WhiteLineInner, ... center ... WhiteLineInner, TrackEdge, KerbOuter]
      const profileRadii = [
        -this.trackRadius - 0.4, // 0: Left Kerb Outer
        -this.trackRadius,       // 1: Left Track Edge
        -this.trackRadius + 0.15,// 2: Left White Line Inner
        this.trackRadius - 0.15, // 3: Right White Line Inner
        this.trackRadius,        // 4: Right Track Edge
        this.trackRadius + 0.4   // 5: Right Kerb Outer
      ];

      const currentStripPositions = profileRadii.map(r => 
        new THREE.Vector3().copy(pos).addScaledVector(sideNormal, r)
      );

      // Push vertices and assign colors per point profile
      currentStripPositions.forEach((pt, idx) => {
        // Flat on ground with micro vertical layers to stop overlapping clipping
        let yOffset = 0.04;
        let finalColor = asphaltColor;

        if (idx === 0 || idx === 5) {
          finalColor = isKerbSegment ? kerbColor : asphaltColor; // Only paint kerbs in sharp corners
          yOffset = isKerbSegment ? 0.06 : 0.04; 
        } else if (idx === 1 || idx === 4) {
          finalColor = whiteLineColor; // White lines
          yOffset = 0.05;
        }

        vertices.push(pt.x, yOffset, pt.z);
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      });

      // Map triangles between this step loop and the next step loop
      if (i < segments) {
        const row = vertexIdx;
        const nextRow = vertexIdx + 6;

        for (let col = 0; col < 5; col++) {
          indices.push(row + col, row + col + 1, nextRow + col);
          indices.push(row + col + 1, nextRow + col + 1, nextRow + col);
        }
      }
      vertexIdx += 6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    return new THREE.Mesh(geometry, material);
  }

  /**
   * Generates solid continuous 3D walls running along the perimeter
   */
  _buildConcreteWalls() {
    const segments = 400;
    const vertices = [];
    const indices = [];
    const UP = new THREE.Vector3(0, 1, 0);
    const wallHeight = 1.2;

    let vIdx = 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

      // Push outer safety wall position point (8 meters outward from spline)
      const outerWallBase = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, this.wallRadius);
      
      // Bottom vertex of wall
      vertices.push(outerWallBase.x, 0, outerWallBase.z);
      // Top vertex of wall
      vertices.push(outerWallBase.x, wallHeight, outerWallBase.z);

      if (i < segments) {
        const r = vIdx;
        const n = vIdx + 2;
        indices.push(r, r + 1, n);
        indices.push(r + 1, n + 1, n);
      }
      vIdx += 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x515a5a, // Concrete gray
      roughness: 0.9,
      metalness: 0.0,
    });
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
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