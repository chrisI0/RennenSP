import * as THREE from 'three';

export class TrackGenerator {
  constructor(scene) {
    this.scene = scene;
    this.trackWidth = 12;
    this.trackRadius = this.trackWidth / 2;
    this.wallRadius = 7.8; // Distance to the concrete safety walls

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
    this.sampledPoints = this.curve.getSpacedPoints(400);

    this._ab = new THREE.Vector3();
    this._ap = new THREE.Vector3();
    this._outA = new THREE.Vector3();
    this._outB = new THREE.Vector3();

    // 1. Compile road and walls
    this.trackSystemMesh = this._buildTrackSystem();
    this.scene.add(this.trackSystemMesh);

    // 2. Generate red/white apex kerbs in turns (both inside and outside edges)
    this.kerbsMesh = this._buildApexKerbs();
    if (this.kerbsMesh) {
      this.scene.add(this.kerbsMesh);
    }

    // 3. Generate FIA start/finish line
    this.startFinishMesh = this._buildStartFinishLine();
    this.scene.add(this.startFinishMesh);
  }

  _buildTrackSystem() {
    const segments = 400;
    const vertices = [];
    const colors = [];
    const indices = [];
    const UP = new THREE.Vector3(0, 1, 0);

    const asphaltColor = new THREE.Color(0x1c1d21);
    const whiteLineColor = new THREE.Color(0xeeeeee);
    const concreteWallColor = new THREE.Color(0xf0f0f0); // White barriers
    
    let vertexCount = 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

      const offsets = [
        -8.0, -8.0, -8.4, -8.4, // Left Wall Loop Profile
        -this.trackRadius - 0.15, -this.trackRadius, 
        this.trackRadius, this.trackRadius + 0.15,
        8.0, 8.0, 8.4, 8.4      // Right Wall Loop Profile
      ];

      offsets.forEach((offset, idx) => {
        const pt = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, offset);
        
        let y = 0.04; // Asphalt center baseline
        if (idx === 1 || idx === 2 || idx === 9 || idx === 10) {
          y = 1.2; // Top of the 3D safety wall barrier blocks
        } else if (idx === 0 || idx === 3 || idx === 8 || idx === 11) {
          y = 0.0; // Foundation floor anchor of the walls
        } else if (idx === 4 || idx === 7) {
          y = 0.05; // Crisp White lines elevated above asphalt (0.04m)
        }

        vertices.push(pt.x, y, pt.z);

        // Color logic
        let finalColor = asphaltColor;
        if (idx === 0 || idx === 1 || idx === 2 || idx === 3) {
          finalColor = concreteWallColor; // Left 3D Barrier Wall (White)
        } else if (idx === 8 || idx === 9 || idx === 10 || idx === 11) {
          finalColor = concreteWallColor; // Right 3D Barrier Wall (White)
        } else if (idx === 4 || idx === 7) {
          finalColor = whiteLineColor;    // Edge Boundary Side Lines (Crisp White)
        } else {
          finalColor = asphaltColor;      // Asphalt core
        }

        colors.push(finalColor.r, finalColor.g, finalColor.b);
      });

      if (i < segments) {
        const r = vertexCount;
        const n = vertexCount + 12;

        // Bridge the 3D Left Wall solid box panels
        indices.push(r+0, r+1, n+0); indices.push(r+1, n+1, n+0); // Inside face
        indices.push(r+1, r+2, n+1); indices.push(r+2, n+2, n+1); // Top face
        indices.push(r+2, r+3, n+2); indices.push(r+3, n+3, n+2); // Outside face

        // Bridge Left White Line panel strip (from 4 to 5)
        indices.push(r+4, r+5, n+4); indices.push(r+5, n+5, n+4);

        // Bridge Main Asphalt Core driving lane tracks (from 5 to 6)
        indices.push(r+5, r+6, n+5); indices.push(r+6, n+6, n+5);

        // Bridge Right White Line panel strip (from 6 to 7)
        indices.push(r+6, r+7, n+6); indices.push(r+7, n+7, n+6);

        // Bridge the 3D Right Wall solid box panels
        indices.push(r+8, r+9, n+8); indices.push(r+9, n+9, n+8);   // Inside face
        indices.push(r+9, r+10, n+9); indices.push(r+10, n+10, n+9); // Top face
        indices.push(r+10, r+11, n+10); indices.push(r+11, n+11, n+10); // Outside face
      }

      vertexCount += 12;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

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
      // Curve zones (segments 35-115 and 145-285)
      const isKerbSegment = (i >= 35 && i < 115) || (i >= 145 && i < 285);
      if (!isKerbSegment) continue;

      const t0 = i / segments;
      const t1 = (i + 1) / segments;

      const pos0 = this.curve.getPointAt(t0);
      const pos1 = this.curve.getPointAt(t1);

      const tangent0 = this.curve.getTangentAt(t0).normalize();
      const tangent1 = this.curve.getTangentAt(t1).normalize();

      const sideNormal0 = new THREE.Vector3().crossVectors(tangent0, UP).normalize();
      const sideNormal1 = new THREE.Vector3().crossVectors(tangent1, UP).normalize();

      // Determine color pattern (alternating pure blocks)
      const isRed = (Math.floor(i / 2) % 2 === 0);
      const finalColor = isRed ? redColor : whiteColor;

      // 1. Left Kerb Quad (from -7.0m to -6.0m, outside of track edge)
      const leftInner0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, -6.0);
      const leftOuter0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, -7.0);
      const leftInner1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, -6.0);
      const leftOuter1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, -7.0);

      vertices.push(leftInner0.x, 0.051, leftInner0.z);
      vertices.push(leftOuter0.x, 0.051, leftOuter0.z);
      vertices.push(leftInner1.x, 0.051, leftInner1.z);
      vertices.push(leftOuter1.x, 0.051, leftOuter1.z);

      for (let j = 0; j < 4; j++) {
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }

      indices.push(vIdx + 0, vIdx + 1, vIdx + 2);
      indices.push(vIdx + 1, vIdx + 3, vIdx + 2);
      vIdx += 4;

      // 2. Right Kerb Quad (from 6.0m to 7.0m, outside of track edge)
      const rightInner0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, 6.0);
      const rightOuter0 = new THREE.Vector3().copy(pos0).addScaledVector(sideNormal0, 7.0);
      const rightInner1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, 6.0);
      const rightOuter1 = new THREE.Vector3().copy(pos1).addScaledVector(sideNormal1, 7.0);

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

    if (vertices.length === 0) return null;

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

  _buildStartFinishLine() {
    const targetSegment = 5;
    const segments = 400;
    const t = targetSegment / segments;
    const pos = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t).normalize();
    const UP = new THREE.Vector3(0, 1, 0);
    const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

    const halfWidth = 0.30; // 0.60m total width (FIA regulation)
    const vertices = [];
    const indices = [];

    const p0 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, -this.trackRadius).addScaledVector(tangent, -halfWidth);
    const p1 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, -this.trackRadius).addScaledVector(tangent, halfWidth);
    const p2 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, this.trackRadius).addScaledVector(tangent, -halfWidth);
    const p3 = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, this.trackRadius).addScaledVector(tangent, halfWidth);

    vertices.push(p0.x, 0.052, p0.z);
    vertices.push(p1.x, 0.052, p1.z);
    vertices.push(p2.x, 0.052, p2.z);
    vertices.push(p3.x, 0.052, p3.z);

    indices.push(0, 1, 2);
    indices.push(2, 1, 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;

    const mesh = new THREE.Mesh(geometry, material);
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