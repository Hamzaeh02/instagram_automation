import { Canvas, useFrame } from "@react-three/fiber"
import { Grid } from "@react-three/drei"
import { Suspense, useRef } from "react"
import type { Mesh } from "three"

function SpinningShape({
  position,
  color,
  scale,
  speed,
  wireframe,
  geometry,
}: {
  position: [number, number, number]
  color: string
  scale: number
  speed: [number, number]
  wireframe: boolean
  geometry: "icosahedron" | "octahedron" | "torusKnot"
}) {
  const ref = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.x += delta * speed[0]
    ref.current.rotation.y += delta * speed[1]
  })

  return (
    <mesh ref={ref} position={position} scale={scale}>
      {geometry === "icosahedron" && <icosahedronGeometry args={[1, 0]} />}
      {geometry === "octahedron" && <octahedronGeometry args={[1, 0]} />}
      {geometry === "torusKnot" && <torusKnotGeometry args={[0.7, 0.22, 100, 12]} />}
      <meshStandardMaterial
        color={color}
        wireframe={wireframe}
        flatShading
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  )
}

export function Scene3D() {
  return (
    <Canvas
      camera={{ position: [0, 1.4, 7], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 5]} intensity={0.5} color="#ffffff" />
      <Suspense fallback={null}>
        <Grid
          position={[0, -2.4, 0]}
          args={[30, 30]}
          cellSize={0.6}
          cellThickness={0.5}
          cellColor="#e7e4d9"
          sectionSize={3}
          sectionThickness={0.7}
          sectionColor="#d6d2c2"
          fadeDistance={14}
          infiniteGrid
        />
        <SpinningShape
          position={[-1.6, 0.6, -1]}
          color="#d8d4c6"
          scale={1.3}
          speed={[0.08, 0.12]}
          wireframe
          geometry="icosahedron"
        />
        <SpinningShape
          position={[1.8, -0.2, -3]}
          color="#a9c95e"
          scale={1.1}
          speed={[0.06, 0.09]}
          wireframe
          geometry="octahedron"
        />
      </Suspense>
    </Canvas>
  )
}
