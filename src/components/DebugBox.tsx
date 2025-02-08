import { useFrame } from '@react-three/fiber'
import React,{ useRef } from 'react'
import { Mesh } from 'three'

export function DebugBox() {
  const meshRef = useRef<Mesh>(null!)

  useFrame((state, delta) => {
    // Simple rotation animation to verify the scene is working
    meshRef.current.rotation.x += delta
    meshRef.current.rotation.y += delta * 0.5
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  )
} 