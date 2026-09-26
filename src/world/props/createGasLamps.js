import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  hash,
  instanceIndex,
  sin,
  time,
  uniform,
  vec3,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildModelBvh } from "../bvh.js";
import { performanceProfile } from "../../platform/performanceProfile.js";

/** Flat ground height (see createGround default y). */
const GROUND_Y = -5.4;

/**
 * Street positions (x, z) picked from the city footprint at eye height so
 * every post has ≥ ~3 units clearance from walls and props. South row sits on
 * the z≈18–22 kerb, north row on z≈30–33.
 */
export const GAS_LAMP_POSITIONS = [
  [-157, 18],
  [-146, 33],
  [-134, 22],
  [-122, 33],
  [-110, 19],
  [-98, 33],
  [-91, 22],
  [-74, 33],
  [-61, 20.5],
  [-48, 33],
  [-38, 19.5],
  [-26, 33],
  [-14, 18],
  [-2, 30.5],
  [10, 18],
  [22, 32.5],
  [34, 18],
];

// Lamp profile (heights relative to ground).
const BASE_TOP = 0.4;
const POST_TOP = 2.85;
const LANTERN_BOTTOM = 2.85;
const LANTERN_HEIGHT = 0.55;
const LANTERN_WIDTH = 0.34;
const LANTERN_CENTER_Y = LANTERN_BOTTOM + LANTERN_HEIGHT * 0.5;

const LAMP_COLOR = new THREE.Color("#ffb46b");

function translated(geometry, y) {
  geometry.translate(0, y, 0);
  return geometry;
}

function createIronGeometry() {
  const parts = [
    // Stepped plinth.
    translated(new THREE.CylinderGeometry(0.2, 0.26, 0.2, 8), 0.1),
    translated(new THREE.CylinderGeometry(0.13, 0.18, 0.2, 8), 0.3),
    // Fluted post (octagonal reads as cast iron at distance).
    translated(
      new THREE.CylinderGeometry(0.055, 0.075, POST_TOP - BASE_TOP, 8),
      (BASE_TOP + POST_TOP) * 0.5,
    ),
    // Collar under the lantern.
    translated(new THREE.CylinderGeometry(0.13, 0.08, 0.12, 8), POST_TOP - 0.06),
    // Lantern floor plate.
    translated(
      new THREE.BoxGeometry(LANTERN_WIDTH + 0.06, 0.04, LANTERN_WIDTH + 0.06),
      LANTERN_BOTTOM + 0.02,
    ),
    // Pyramid roof + finial.
    translated(
      new THREE.ConeGeometry(0.3, 0.26, 4).rotateY(Math.PI / 4),
      LANTERN_BOTTOM + LANTERN_HEIGHT + 0.13,
    ),
    translated(
      new THREE.CylinderGeometry(0.012, 0.03, 0.14, 6),
      LANTERN_BOTTOM + LANTERN_HEIGHT + 0.33,
    ),
  ];

  // Four corner mullions framing the glass.
  const half = LANTERN_WIDTH * 0.5;
  for (const [x, z] of [
    [half, half],
    [-half, half],
    [half, -half],
    [-half, -half],
  ]) {
    parts.push(
      new THREE.BoxGeometry(0.025, LANTERN_HEIGHT, 0.025).translate(
        x,
        LANTERN_CENTER_Y,
        z,
      ),
    );
  }

  // Drop UVs so merge doesn't fail on mismatched attributes.
  for (const part of parts) {
    part.deleteAttribute("uv");
  }

  const merged = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
}

function createGlassGeometry() {
  return new THREE.BoxGeometry(
    LANTERN_WIDTH,
    LANTERN_HEIGHT,
    LANTERN_WIDTH,
  ).translate(0, LANTERN_CENTER_Y, 0);
}

function createInstancedMesh(geometry, material, positions, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const matrix = new THREE.Matrix4();

  positions.forEach(([x, z], index) => {
    matrix.makeTranslation(x, GROUND_Y, z);
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  return mesh;
}

/** Invisible cylinders so walk mode can't pass through the posts. */
function createCollider(positions) {
  const pieces = positions.map(([x, z]) =>
    new THREE.CylinderGeometry(0.3, 0.3, POST_TOP, 8).translate(
      x,
      GROUND_Y + POST_TOP * 0.5,
      z,
    ),
  );
  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) {
    piece.dispose();
  }

  const collider = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial());
  collider.name = "gas-lamp-collider";
  collider.visible = false;
  buildModelBvh(collider);
  return collider;
}

/** Cheap two-sine flicker, mirrored on CPU for the point lights. */
function cpuFlicker(t, seed, amount) {
  const wave =
    Math.sin(t * 7.3 + seed * 13.1) * 0.5 + Math.sin(t * 2.1 + seed * 5.7) * 0.5;
  return 1 + wave * amount;
}

/**
 * Victorian gas street lamps: two instanced draws (iron + glass), emissive
 * glass for bloom, and a small pool of point lights that follow the lamps
 * nearest the camera (constant light count → no shader recompiles).
 */
export function createGasLamps(scene, { positions = GAS_LAMP_POSITIONS } = {}) {
  const group = new THREE.Group();
  group.name = "gas-lamps";

  const ironMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x16181b,
    metalness: 0.75,
    roughness: 0.42,
  });

  const params = {
    glowIntensity: uniform(6),
    flickerAmount: uniform(0.06),
    lightIntensity: 18,
    lightDistance: 16,
  };

  const glassMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x2a1c10,
    metalness: 0,
    roughness: 0.15,
  });
  glassMaterial.emissiveNode = Fn(() => {
    const seed = hash(instanceIndex);
    const wave = sin(time.mul(7.3).add(seed.mul(13.1)))
      .mul(0.5)
      .add(sin(time.mul(2.1).add(seed.mul(5.7))).mul(0.5));
    const flicker = float(1).add(wave.mul(params.flickerAmount));
    return vec3(LAMP_COLOR.r, LAMP_COLOR.g, LAMP_COLOR.b)
      .mul(params.glowIntensity)
      .mul(flicker);
  })();

  const iron = createInstancedMesh(
    createIronGeometry(),
    ironMaterial,
    positions,
    "gas-lamp-iron",
  );
  iron.castShadow = true;
  iron.receiveShadow = true;

  const glass = createInstancedMesh(
    createGlassGeometry(),
    glassMaterial,
    positions,
    "gas-lamp-glass",
  );

  group.add(iron, glass);

  const lightCount = Math.min(
    performanceProfile.gasLampLightCount ?? 0,
    positions.length,
  );
  const lights = [];
  for (let i = 0; i < lightCount; i++) {
    const light = new THREE.PointLight(
      LAMP_COLOR,
      params.lightIntensity,
      params.lightDistance,
      2,
    );
    light.castShadow = false;
    light.userData.lampIndex = -1;
    lights.push(light);
    group.add(light);
  }

  scene.add(group);

  const collider = createCollider(positions);
  scene.add(collider);

  const lampSeeds = positions.map((_, i) => ((i * 2654435761) % 1000) / 1000);
  const order = positions.map((_, i) => i);
  const reassignInterval = 0.25;
  let sinceReassign = reassignInterval;
  let elapsed = 0;

  function assignNearest(camera) {
    const cx = camera.position.x;
    const cz = camera.position.z;
    order.sort((a, b) => {
      const [ax, az] = positions[a];
      const [bx, bz] = positions[b];
      return (ax - cx) ** 2 + (az - cz) ** 2 - ((bx - cx) ** 2 + (bz - cz) ** 2);
    });

    for (let i = 0; i < lights.length; i++) {
      const lampIndex = order[i];
      const light = lights[i];
      if (light.userData.lampIndex === lampIndex) {
        continue;
      }
      const [x, z] = positions[lampIndex];
      light.position.set(x, GROUND_Y + LANTERN_CENTER_Y, z);
      light.userData.lampIndex = lampIndex;
    }
  }

  function update(delta, camera) {
    elapsed += delta;
    sinceReassign += delta;

    if (lights.length === 0) {
      return;
    }

    if (camera && sinceReassign >= reassignInterval) {
      sinceReassign = 0;
      assignNearest(camera);
    }

    const flickerAmount = params.flickerAmount.value;
    for (const light of lights) {
      const seed = lampSeeds[light.userData.lampIndex] ?? 0;
      light.intensity =
        params.lightIntensity * cpuFlicker(elapsed, seed, flickerAmount);
      light.distance = params.lightDistance;
    }
  }

  function dispose() {
    scene.remove(group);
    scene.remove(collider);
    iron.geometry.dispose();
    glass.geometry.dispose();
    collider.geometry.disposeBoundsTree?.();
    collider.geometry.dispose();
    ironMaterial.dispose();
    glassMaterial.dispose();
    collider.material.dispose();
  }

  return {
    group,
    collider,
    lights,
    params,
    positions,
    update,
    dispose,
  };
}
