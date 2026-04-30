"use client";

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

type DinnerRoomHall3DProps = {
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
};

let floorTextureCache: CanvasTexture | null = null;
let carpetTextureCache: CanvasTexture | null = null;

function createParquetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.fillStyle = "#c9b18f";
  context.fillRect(0, 0, 1024, 1024);

  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const x = col * 128;
      const y = row * 64;
      context.fillStyle =
        (row + col) % 3 === 0 ? "#b99269" : (row + col) % 3 === 1 ? "#caa27a" : "#b4865b";
      context.fillRect(x, y, 124, 60);
      context.strokeStyle = "rgba(78, 52, 32, 0.18)";
      context.lineWidth = 2;
      context.strokeRect(x, y, 124, 60);
    }
  }

  for (let index = 0; index < 180; index += 1) {
    context.strokeStyle = `rgba(255,255,255,${0.01 + (index % 5) * 0.005})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo((index * 17) % 1024, 0);
    context.lineTo((index * 17) % 1024, 1024);
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 5);
  texture.colorSpace = SRGBColorSpace;

  return texture;
}

function createCarpetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#5f2430");
  gradient.addColorStop(0.5, "#6d2734");
  gradient.addColorStop(1, "#53202a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 26; index += 1) {
    context.strokeStyle =
      index % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, index * 20);
    context.lineTo(512, index * 20);
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = SRGBColorSpace;

  return texture;
}

function getFloorTexture() {
  if (!floorTextureCache) {
    floorTextureCache = createParquetTexture();
  }

  return floorTextureCache;
}

function getCarpetTexture() {
  if (!carpetTextureCache) {
    carpetTextureCache = createCarpetTexture();
  }

  return carpetTextureCache;
}

export default function DinnerRoomHall3D({
  width,
  depth,
  centerX,
  centerZ,
}: DinnerRoomHall3DProps) {
  const carpetWidth = width * 0.78;
  const carpetDepth = depth * 0.72;

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.8, centerZ]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          color="#c9b18f"
          map={getFloorTexture() ?? undefined}
          roughness={0.92}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.785, centerZ]} receiveShadow>
        <planeGeometry args={[carpetWidth, carpetDepth]} />
        <meshStandardMaterial
          color="#612734"
          map={getCarpetTexture() ?? undefined}
          roughness={0.94}
        />
      </mesh>
    </>
  );
}
