import {
  Fn,
  float,
  length,
  luminance,
  mix,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";

export function createBillboardVignetteUniforms({
  vignetteInner = 0.05,
  vignetteOuter = 0.75,
  vignetteMin = 0.0,
  // Applied in emissiveNode — material.emissiveIntensity is ignored once
  // emissiveNode is set (Three.js overwrites the default emissive path).
  emissiveIntensity = 0.08,
  // Old oil-portrait grade: 0 = original video, 1 = full sepia.
  sepiaAmount = 0.85,
  // Slow candle-light flicker amplitude.
  flickerAmount = 0.08,
} = {}) {
  return {
    vignetteInner: uniform(vignetteInner),
    vignetteOuter: uniform(vignetteOuter),
    vignetteMin: uniform(vignetteMin),
    emissiveIntensity: uniform(emissiveIntensity),
    sepiaAmount: uniform(sepiaAmount),
    flickerAmount: uniform(flickerAmount),
  };
}

const SEPIA_TINT = vec3(1.0, 0.82, 0.6);

export function createBillboardFaceOutput(videoTexture, vignetteUniforms) {
  const videoSample = texture(videoTexture);
  const {
    vignetteInner,
    vignetteOuter,
    vignetteMin,
    sepiaAmount,
    flickerAmount,
  } = vignetteUniforms;

  const output = Fn(() => {
    const vUv = uv();
    const centered = vUv.sub(0.5);
    const edgeDist = length(centered).mul(2);
    const vignette = float(1).sub(
      smoothstep(vignetteInner, vignetteOuter, edgeDist),
    );
    const edgeFalloff = mix(vignetteMin, float(1), vignette);

    const sepia = luminance(videoSample.rgb).mul(SEPIA_TINT);
    const graded = mix(videoSample.rgb, sepia, sepiaAmount);

    // Two incommensurate sines read as an irregular candle flicker.
    const flickerWave = sin(time.mul(2.3))
      .mul(0.6)
      .add(sin(time.mul(5.7)).mul(0.4));
    const flicker = float(1).add(flickerWave.mul(flickerAmount));

    const rgb = graded.mul(edgeFalloff).mul(flicker);

    return vec4(rgb, videoSample.a);
  })();

  return { output };
}
