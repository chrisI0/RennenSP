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
        
        // Sun glow
        float sunDot = max(dot(direction, uSunDirection), 0.0);
        float sunDisc = pow(sunDot, 800.0) * 3.0;
        float sunGlow = pow(sunDot, 8.0) * 0.4;
        float sunHalo = pow(sunDot, 3.0) * 0.15;
        
        color += uSunColor * (sunDisc + sunGlow + sunHalo) * uSunIntensity;
        
        // Horizon haze
        float horizonHaze = 1.0 - abs(height);
        horizonHaze = pow(horizonHaze, 12.0);
        color += uHorizonColor * horizonHaze * 0.3;
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x0a0e1a) },
      uMidColor: { value: new THREE.Color(0x141828) },
      uHorizonColor: { value: new THREE.Color(0x1a1520) },
      uGroundColor: { value: new THREE.Color(0x08080c) },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.15, -0.9).normalize() },
      uSunColor: { value: new THREE.Color(0xff8844) },
      uSunIntensity: { value: 1.2 },
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
  const sun = new THREE.DirectionalLight(0xffeedd, 3.0);
  sun.position.set(80, 30, -180);
  sun.castShadow = true;

  // Shadow map settings
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.bias = -0.0005;

  return sun;
}

/**
 * Creates ambient fill light.
 * @returns {THREE.HemisphereLight}
 */
function createAmbientLight() {
  return new THREE.HemisphereLight(
    0x8899cc, // sky color — bright blue-white for dev visibility
    0x445566, // ground color — visible fill from below
    2.0       // intensity — high for global illumination feel
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

  // Add a subtle point light to give some local illumination interest
  const accentLight = new THREE.PointLight(0xdd4400, 0.3, 50);
  accentLight.position.set(0, 8, 0);
  scene.add(accentLight);

  // Scene fog for depth
  // Fog disabled during development for full grid visibility
  // scene.fog = new THREE.FogExp2(0x0a0a12, 0.00015);

  return { sky, sunLight, ambientLight, accentLight };
}
