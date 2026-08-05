"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function GridFloor() {
  const meshRef = useRef<THREE.GridHelper>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.position.z = ((clock.elapsedTime * 1.2) % 4);
    }
  });

  return (
    <gridHelper
      ref={meshRef}
      args={[160, 40, "#7c5cff", "rgba(124,92,255,0.12)"]}
      position={[0, -4, -4]}
    />
  );
}

function Particles() {
  const count = 600;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 120;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 60;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    return arr;
  }, [count]);

  const pointsRef = useRef<THREE.Points>(null);

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.elapsedTime * 0.02;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.18}
        color="#7c5cff"
        transparent
        opacity={0.55}
        sizeAttenuation
      />
    </points>
  );
}

export default function CelestialBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(60% 55% at 70% 20%, rgba(124,92,255,0.06) 0%, transparent 60%), radial-gradient(50% 45% at 20% 80%, rgba(0,255,148,0.03) 0%, transparent 60%)",
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 4, 12], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        style={{ opacity: 0.7 }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.4} />
          <GridFloor />
          <Particles />
        </Suspense>
      </Canvas>
    </div>
  );
}