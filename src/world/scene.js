import * as THREE from "three/webgpu";

export function freezeStaticTransforms(root) {
  root.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.updateMatrix();
  });
  root.updateMatrixWorld(true);
}

export function addModel(scene, model) {
  scene.add(model);
  freezeStaticTransforms(model);
  return model.position.clone();
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06080d);

  const SHADOW_EXTENT = 200;
  const SUN_DISTANCE = 150;

  // Moonlight key: cool and dim so warm lamp light reads as the accent.
  const sunLight = new THREE.DirectionalLight("#9fb4d8", 2.5);
  sunLight.position.set(23, 31, 3);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = SUN_DISTANCE + SHADOW_EXTENT * 2;
  sunLight.shadow.camera.left = -SHADOW_EXTENT;
  sunLight.shadow.camera.right = SHADOW_EXTENT;
  sunLight.shadow.camera.top = SHADOW_EXTENT;
  sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.shadow.bias = -0.001;
  sunLight.shadow.normalBias = 0.009;
  sunLight.shadow.intensity = 1.4;
  sunLight.shadow.autoUpdate = false;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Warm bounce from gas lamps.
  const fillLight = new THREE.DirectionalLight("#ffb070", 1.2);
  fillLight.position.set(-18, 22, -12);
  fillLight.target.position.set(0, 0, 0);
  fillLight.castShadow = false;
  scene.add(fillLight);
  scene.add(fillLight.target);

  const sunState = {
    intensity: sunLight.intensity,
    shadowIntensity: sunLight.shadow.intensity,
    color: `#${sunLight.color.getHexString()}`,
    x: sunLight.position.x,
    y: sunLight.position.y,
    z: sunLight.position.z,
  };

  function applySun() {
    sunLight.intensity = sunState.intensity;
    sunLight.shadow.intensity = sunState.shadowIntensity;
    sunLight.color.set(sunState.color);
    sunLight.position.set(sunState.x, sunState.y, sunState.z);
    sunLight.target.updateMatrixWorld();
  }

  applySun();

  return { scene, sunLight, fillLight, sunState, applySun };
}
