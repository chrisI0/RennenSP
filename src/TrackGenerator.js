import * as THREE from 'three';

export class TrackGenerator {
  constructor(scene) {
    this.scene = scene;
    this.trackWidth = 12;
    this.trackRadius = this.trackWidth / 2;

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

    // Pre-allocated lookup data structures
    this.sampledPoints = this.curve.getSpacedPoints(300);
    this._ab = new THREE.Vector3();
    this._ap = new THREE.Vector3();
    this._outA = new THREE.Vector3();
    this._outB = new THREE.Vector3();

    // 2. Build the flat meshes manually
    this.roadMesh = this._buildFlatRibbon(this.trackRadius, 0x18181b, 0.04, 0.85); // Asphalt
    this.kerbsMesh = this._buildFlatRibbon(this.trackRadius + 0.3, 0xd32f2f, 0.03, 1.0, true); // Red border underneath

    this.scene.add(this.roadMesh);
    this.scene.add(this.kerbsMesh);
  }

  /**
   * Manually creates a flat triangle ribbon mesh that is locked to the ground plane.
   */
  _buildFlatRibbon(radius, colorHex, heightOffset, roughness, isBasic = false) {
    const segments = 300;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const UP = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      
      // Force the side normal vector to stay perfectly on the horizontal ground plane
      const sideNormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();

      // Compute left and right boundary edge coordinates
      const left = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, -radius);
      const right = new THREE.Vector3().copy(pos).addScaledVector(sideNormal, radius);

      vertices.push(left.x, heightOffset, left.z);
      vertices.push(right.x, heightOffset, right.z);

      normals.push(0, 1, 0);
      normals.push(0, 1, 0);

      uvs.push(0, t);
      uvs.push(1, t);
    }

    for (let i = 0; i < segments; i++) {
      const i0 = i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;

      // Map triangles face indices clockwise
      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    let material;
    if (isBasic) {
      material = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: roughness,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = !isBasic;
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