import * as THREE from 'three';

/**
 * Sets up the environment: sky, sun, ambient lighting, and fog.
 * Creates a realistic outdoor atmosphere suitable for a racing sim.
 */

/**
 * Creates a gradient sky dome using a custom shader.
 * @returns {THREE.Mesh}
 */
function createSky() {
  const skyGeometry = new THREE.SphereGeometry(9000, 32, 32);

  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPosition;
      
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform float uSunIntensity;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float height = direction.y;
        
        // Sky gradient
        vec3 color;
        if (height > 0.0) {
          // Above horizon: horizon -> mid -> top
          float t = pow(height, 0.5);
          color = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.3, t));
          color = mix(color, uTopColor, smoothstep(0.3, 1.0, t));
        } else {
          // Below horizon: darken towards ground
          float t = pow(abs(height), 0.7);
          color = mix(uHorizonColor, uGroundColor, t);
        }
        
        // Sun glow (tightened for a crisp midday sun disc)
        float sunDot = max(dot(direction, uSunDirection), 0.0);
        float sunDisc = pow(sunDot, 2000.0) * 4.0;
        float sunGlow = pow(sunDot, 40.0) * 0.2;
        float sunHalo = pow(sunDot, 12.0) * 0.05;
        
        color += uSunColor * (sunDisc + sunGlow + sunHalo) * uSunIntensity;
        
        // Horizon haze
        float horizonHaze = 1.0 - abs(height);
        horizonHaze = pow(horizonHaze, 12.0);
        color += uHorizonColor * horizonHaze * 0.3;
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x1b4f72) },      // Deep vibrant sky blue
      uMidColor: { value: new THREE.Color(0x3498db) },      // Bright atmospheric blue
      uHorizonColor: { value: new THREE.Color(0xd6eaf8) },  // Soft horizon haze blue
      uGroundColor: { value: new THREE.Color(0x1c2833) },   // Neutral dark slate ground
      uSunDirection: { value: new THREE.Vector3(0.1, 0.95, -0.2).normalize() }, // Overhead sun
      uSunColor: { value: new THREE.Color(0xffffff) },      // Bright white sunlight
      uSunIntensity: { value: 1.5 },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });

  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -2;
  return sky;
}

/**
 * Creates the directional (sun) light with shadows.
 * @returns {THREE.DirectionalLight}
 */
function createSunLight() {
  const sun = new THREE.DirectionalLight(0xfffff0, 3.0); // Crisp daylight with gold tint
  sun.position.set(20, 150, -40); // Matches uSunDirection
  sun.castShadow = true;

  // Shadow map settings
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  
  // Tightened shadow frustum for sharp vehicle shadows
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.bias = -0.0005;

  return sun;
}

/**
 * Creates ambient fill light.
 * @returns {THREE.HemisphereLight}
 */
function createAmbientLight() {
  return new THREE.HemisphereLight(
    0xaed6f1, // Light blue sky color
    0x2c3e50, // Slate ground color
    1.1       // Natural fill intensity
  );
}

/**
 * Sets up the entire environment in the scene.
 * @param {THREE.Scene} scene
 */
export function setupEnvironment(scene) {
  const sky = createSky();
  scene.add(sky);

  const sunLight = createSunLight();
  scene.add(sunLight);
  scene.add(sunLight.target);

  const ambientLight = createAmbientLight();
  scene.add(ambientLight);

  // Scene fog for depth
  // Fog disabled during development for full grid visibility
  // scene.fog = new THREE.FogExp2(0x0a0a12, 0.00015);

  return { sky, sunLight, ambientLight };
}
