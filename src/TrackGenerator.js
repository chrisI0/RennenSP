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

    // Generate Apex Kerbs
    this.kerbsMesh = this._buildApexKerbs();
    this.scene.add(this.kerbsMesh);

    // 3. Generate 3D Solid Concrete Barriers
    this.wallMesh = this._buildConcreteWalls();
    this.scene.add(this.wallMesh);
  }

  /**
   * Compiles asphalt and clean white lines into an optimized geometry block
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

      const whiteLineColor = new THREE.Color(0xeeeeee);
      const asphaltColor = new THREE.Color(0x18181b);

      // Define cross section profile nodes across the 12m track profile
      // [Left Track Edge, Left White Line Inner, Right White Line Inner, Right Track Edge]
      const profileRadii = [
        -this.trackRadius,       // 0: Left Track Edge
        -this.trackRadius + 0.15,// 1: Left White Line Inner
        this.trackRadius - 0.15, // 2: Right White Line Inner
        this.trackRadius,        // 3: Right Track Edge
      ];

      const currentStripPositions = profileRadii.map(r => 
        new THREE.Vector3().copy(pos).addScaledVector(sideNormal, r)
      );

      // Push vertices and assign colors per point profile
      currentStripPositions.forEach((pt, idx) => {
        let yOffset = 0.04;
        let finalColor = asphaltColor;

        if (idx === 0 || idx === 3) {
          finalColor = whiteLineColor; // White lines
          yOffset = 0.05;
        }

        vertices.push(pt.x, yOffset, pt.z);
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      });

      // Map triangles between this step loop and the next step loop
      if (i < segments) {
        const row = vertexIdx;
        const nextRow = vertexIdx + 4;

        for (let col = 0; col < 3; col++) {
          indices.push(row + col, row + col + 1, nextRow + col);
          indices.push(row + col + 1, nextRow + col + 1, nextRow + col);
        }
      }
      vertexIdx += 4;
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
   * Generates separate rectangular quad steps for alternating apex kerbs
   */
  _buildApexKerbs() {
    const segments = 400;
    const vertices = [];
    const colors = [];
    const indices = [];
    const UP = new THREE.Vector3(0, 1, 0);

    const redColor = new THREE.Color(0xd32f2f);
    const whiteColor = new THREE.Color(0xffffff);

    let vIdx = 0;

    for (let i = 0; i < segments; i++) {
      // Curve zones (segments 40-110 and 150-280)
      const isKerbSegment = (i >= 40 && i < 110) || (i >= 150 && i < 280);
      if (!isKerbSegment) continue;

      const t0 = i / segments;
      const t1 = (i + 1) / segments;

      const pos0 = this.curve.getPointAt(t0);
      const pos1 = this.curve.getPointAt(t1);

      const tangent0 = this.curve.getTangentAt(t0).normalize();
      const tangent1 = this.curve.getTangentAt(t1).normalize();

      const sideNormal0 = new THREE.Vector3().crossVectors(tangent0, UP).normalize();
      const sideNormal1 = new THREE.Vector3().crossVectors(tangent1, UP).normalize();

      // Determine quad color: Math.floor(i / 2) % 2 === 0 -> red, else white
      const isRed = (Math.floor(i / 2) % 2 === 0);
      const finalColor = isRed ? redColor : whiteColor;

      // 1. Left Kerb Quad (from -6.6m to -6.0m)
      const leftInner0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, -6.0);
      const leftOuter0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, -6.6);
      const leftInner1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, -6.0);
      const leftOuter1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, -6.6);

      // Height offset 0.051m to prevent Z-fighting
      vertices.push(leftInner0.x, 0.051, leftInner0.z);
      vertices.push(leftOuter0.x, 0.051, leftOuter0.z);
      vertices.push(leftInner1.x, 0.051, leftInner1.z);
      vertices.push(leftOuter1.x, 0.051, leftOuter1.z);

      for (let j = 0; j < 4; j++) {
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }

      indices.push(vIdx + 0, vIdx + 2, vIdx + 1);
      indices.push(vIdx + 1, vIdx + 2, vIdx + 3);
      vIdx += 4;

      // 2. Right Kerb Quad (from 6.0m to 6.6m)
      const rightInner0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, 6.0);
      const rightOuter0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, 6.6);
      const rightInner1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, 6.0);
      const rightOuter1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, 6.6);

      vertices.push(rightInner0.x, 0.051, rightInner0.z);
      vertices.push(rightOuter0.x, 0.051, rightOuter0.z);
      vertices.push(rightInner1.x, 0.051, rightInner1.z);
      vertices.push(rightOuter1.x, 0.051, rightOuter1.z);

      for (let j = 0; j < 4; j++) {
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }

      indices.push(vIdx + 0, vIdx + 1, vIdx + 2);
      indices.push(vIdx + 1, vIdx + 3, vIdx + 2);
      vIdx += 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
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
    const halfThickness = 0.2;

    let vIdx = 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

      // Inner Base (-0.2m relative to wallRadius)
      const p0 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, this.wallRadius - halfThickness);
      // Inner Top
      const p1 = new THREE.Vector3().copy(p0);
      p1.y = wallHeight;
      // Outer Top (+0.2m thickness)
      const p2 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, this.wallRadius + halfThickness);
      p2.y = wallHeight;
      // Outer Base
      const p3 = new THREE.Vector3().copy(p2);
      p3.y = 0;

      vertices.push(p0.x, 0, p0.z);
      vertices.push(p1.x, p1.y, p1.z);
      vertices.push(p2.x, p2.y, p2.z);
      vertices.push(p3.x, 0, p3.z);

      if (i < segments) {
        const r = vIdx;
        const n = vIdx + 4;

        // Inner Face (r0, r1, n0, n1)
        indices.push(r + 0, n + 0, n + 1);
        indices.push(r + 0, n + 1, r + 1);

        // Top Face (r1, r2, n1, n2)
        indices.push(r + 1, n + 1, n + 2);
        indices.push(r + 1, n + 2, r + 2);

        // Outer Face (r2, r3, n2, n3)
        indices.push(r + 2, n + 2, n + 3);
        indices.push(r + 2, n + 3, r + 3);

        // Bottom Face (r3, r0, n3, n0)
        indices.push(r + 3, n + 3, n + 0);
        indices.push(r + 3, n + 0, r + 0);
      }
      vIdx += 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0, // Crisp, matte regulatory white
      roughness: 0.7,
      metalness: 0.1,
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