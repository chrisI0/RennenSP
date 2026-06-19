import * as THREE from 'three';

/**
 * Creates an infinite-looking grid plane using a custom shader.
 * The grid fades out smoothly at the horizon and has both fine
 * and coarse lines for a realistic ground-plane feel.
 */

const gridVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying float vFogDepth;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    
    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;
    
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const gridFragmentShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying float vFogDepth;

  uniform vec3 uBaseColor;
  uniform vec3 uLineColor;
  uniform vec3 uMajorLineColor;
  uniform float uGridScale;
  uniform float uMajorGridScale;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  float gridLine(vec2 coord, float scale, float lineWidth) {
    vec2 grid = abs(fract(coord / scale - 0.5) - 0.5);
    vec2 deriv = fwidth(coord / scale);
    vec2 lines = smoothstep(deriv * (lineWidth + 1.0), deriv * lineWidth, grid);
    return max(lines.x, lines.y);
  }

  void main() {
    vec2 coord = vWorldPos.xz;
    
    // Distance-based fade
    float dist = length(vWorldPos.xz);
    float fadeFactor = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
    
    // Minor grid lines (1m spacing)
    float minorGrid = gridLine(coord, uGridScale, 0.8);
    
    // Major grid lines (10m spacing)
    float majorGrid = gridLine(coord, uMajorGridScale, 1.2);

    // Axis lines (thicker, slightly highlighted)
    float axisLineWidth = 2.5;
    vec2 axisDeriv = fwidth(coord);
    float xAxis = 1.0 - smoothstep(axisDeriv.y * axisLineWidth, axisDeriv.y * (axisLineWidth + 1.0), abs(coord.y));
    float zAxis = 1.0 - smoothstep(axisDeriv.x * axisLineWidth, axisDeriv.x * (axisLineWidth + 1.0), abs(coord.x));
    float axisLine = max(xAxis, zAxis);

    // Composite color
    vec3 color = uBaseColor;
    color = mix(color, uLineColor, minorGrid * 0.35 * fadeFactor);
    color = mix(color, uMajorLineColor, majorGrid * 0.6 * fadeFactor);
    color = mix(color, vec3(0.35, 0.15, 0.1), axisLine * 0.5 * fadeFactor);

    // Apply alpha fade
    float alpha = fadeFactor * 0.95;
    
    // Distance fog
    float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
    color = mix(color, uFogColor, fogFactor);
    
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Creates the infinite grid and returns the mesh.
 * @returns {THREE.Mesh}
 */
export function createGrid() {
  // 20km x 20km plane — large enough for the full Nürburgring Nordschleife (~7x4km)
  const geometry = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    vertexShader: gridVertexShader,
    fragmentShader: gridFragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(0x1a1a24) },
      uLineColor: { value: new THREE.Color(0x3a3a55) },
      uMajorLineColor: { value: new THREE.Color(0x555577) },
      uGridScale: { value: 1.0 },        // 1 meter minor grid
      uMajorGridScale: { value: 10.0 },   // 10 meter major grid
      uFadeStart: { value: 500.0 },
      uFadeEnd: { value: 5000.0 },
      uFogColor: { value: new THREE.Color(0x0a0a12) },
      uFogNear: { value: 1000.0 },
      uFogFar: { value: 8000.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return mesh;
}
