"use client";

import { useMemo } from "react";
import { RoundedBox, Text } from "@react-three/drei";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

import { Silla, normalizeReservas } from "@/lib/dinner-room";
import {
  getTableDimensions,
  getRectangleChairSlots,
} from "@/lib/room-layout";

type DinnerRoomTable3DProps = {
  mesaId: string;
  mesaNumero: number;
  sillas: Silla[];
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
};

const TABLE_WORLD_HEIGHT = 0.18;
const HIT_WIDTH = 1.45;
const HIT_DEPTH = 1.12;

let woodTextureCache: CanvasTexture | null = null;
let clothTextureCache: CanvasTexture | null = null;

function createStripedTexture(baseColor: string, accentA: string, accentB: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 18; index += 1) {
    context.fillStyle = index % 2 === 0 ? accentA : accentB;
    context.fillRect(0, index * 14, canvas.width, 8);
  }

  for (let index = 0; index < 60; index += 1) {
    context.fillStyle = `rgba(255,255,255,${0.015 + (index % 5) * 0.008})`;
    context.fillRect((index * 23) % canvas.width, 0, 2, canvas.height);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.colorSpace = SRGBColorSpace;

  return texture;
}

function getWoodTexture() {
  if (!woodTextureCache) {
    woodTextureCache = createStripedTexture("#6b4f3a", "#8b674d", "#5d4532");
  }

  return woodTextureCache;
}

function getClothTexture() {
  if (!clothTextureCache) {
    clothTextureCache = createStripedTexture("#ede7dc", "#f8f5ef", "#ddd3c3");
  }

  return clothTextureCache;
}

function getChairColor(
  silla: Silla,
  selectedSillaId: string | null,
  currentAsistenteId: string,
) {
  const reservas = normalizeReservas(silla.reservas);
  const reservaActual = reservas[0];

  if (selectedSillaId === silla.id) {
    return "#facc15";
  }

  if (reservaActual?.asistente_id === currentAsistenteId) {
    return "#0ea5e9";
  }

  if (reservaActual) {
    return "#ef4444";
  }

  return "#22c55e";
}

function ChairModel({
  color,
  number,
  selected,
}: {
  color: string;
  number: number;
  selected: boolean;
}) {
  return (
    <group>
      <RoundedBox
        args={[0.62, 0.12, 0.46]}
        radius={0.06}
        smoothness={4}
        position={[0, 0.06, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          roughness={0.38}
          metalness={0.06}
          emissive={selected ? "#7c2d12" : "#000000"}
          emissiveIntensity={selected ? 0.18 : 0}
        />
      </RoundedBox>

      <RoundedBox
        args={[0.62, 0.72, 0.1]}
        radius={0.05}
        smoothness={4}
        position={[0, 0.42, -0.2]}
        castShadow
      >
        <meshStandardMaterial color="#efe7dc" roughness={0.62} metalness={0.04} />
      </RoundedBox>

      <RoundedBox
        args={[0.5, 0.5, 0.06]}
        radius={0.05}
        smoothness={4}
        position={[0, 0.42, -0.135]}
        castShadow
      >
        <meshStandardMaterial color={color} roughness={0.34} metalness={0.04} />
      </RoundedBox>

      {[
        [-0.22, -0.02, -0.14],
        [0.22, -0.02, -0.14],
        [-0.22, -0.02, 0.14],
        [0.22, -0.02, 0.14],
      ].map((position, index) => (
        <mesh key={index} castShadow position={position as [number, number, number]}>
          <cylinderGeometry args={[0.03, 0.04, 0.56, 12]} />
          <meshStandardMaterial color="#3f3f46" roughness={0.68} metalness={0.25} />
        </mesh>
      ))}

      <Text
        position={[0, 0.09, 0.02]}
        fontSize={0.16}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        {String(number)}
      </Text>
    </group>
  );
}

export default function DinnerRoomTable3D({
  mesaId,
  mesaNumero,
  sillas,
  selectedSillaId,
  currentAsistenteId,
  selectionLocked,
  onSelectSilla,
}: DinnerRoomTable3DProps) {
  const tableDimensions = useMemo(() => getTableDimensions(sillas.length), [sillas.length]);
  const tableWorldWidth = (tableDimensions.width / 180) * 2.7;
  const tableWorldDepth = (tableDimensions.height / 100) * 1.5;

  const chairSlots = useMemo(() => {
    const slots = getRectangleChairSlots(
      sillas.length,
      tableDimensions.width,
      tableDimensions.height,
      tableDimensions.chairOffset,
    );

    return slots.map((slot) => ({
      x: (slot.x / tableDimensions.width) * tableWorldWidth,
      z: (slot.y / tableDimensions.height) * tableWorldDepth,
      rotation: slot.rotation,
    }));
  }, [sillas.length, tableDimensions, tableWorldDepth, tableWorldWidth]);

  function handleChairSelection(
    sillaId: string,
    sillaOcupada: boolean,
    sillaEsDelAsistente: boolean,
  ) {
    if (selectionLocked || sillaOcupada || sillaEsDelAsistente) {
      return;
    }

    onSelectSilla(selectedSillaId === sillaId ? null : sillaId);
  }

  return (
    <group name={`mesa-${mesaId}`}>
      <mesh castShadow position={[0, -0.56, 0]}>
        <boxGeometry args={[0.22, 1.1, 1.1]} />
        <meshStandardMaterial color="#5b4636" roughness={0.64} />
      </mesh>

      <RoundedBox
        args={[tableWorldWidth + 0.16, TABLE_WORLD_HEIGHT, tableWorldDepth + 0.16]}
        radius={0.08}
        smoothness={4}
        position={[0, 0.02, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#6b4f3a"
          map={getWoodTexture() ?? undefined}
          roughness={0.56}
          metalness={0.08}
        />
      </RoundedBox>

      <RoundedBox
        args={[tableWorldWidth, 0.08, tableWorldDepth]}
        radius={0.08}
        smoothness={4}
        position={[0, 0.14, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#efe7dc"
          map={getClothTexture() ?? undefined}
          roughness={0.9}
          metalness={0.02}
        />
      </RoundedBox>

      <mesh castShadow position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.18, 20]} />
        <meshStandardMaterial color="#c8a54f" metalness={0.5} roughness={0.3} />
      </mesh>

      <mesh castShadow position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.08, 20, 20]} />
        <meshStandardMaterial color="#8f1d2c" roughness={0.7} />
      </mesh>

      <Text
        position={[0, 0.3, 0]}
        fontSize={0.24}
        color="#292524"
        anchorX="center"
        anchorY="middle"
      >
        {`Mesa ${mesaNumero}`}
      </Text>

      {sillas.map((silla, index) => {
        const slot = chairSlots[index];
        const reservas = normalizeReservas(silla.reservas);
        const sillaOcupada = reservas.length > 0;
        const sillaEsDelAsistente =
          reservas[0]?.asistente_id === currentAsistenteId;
        const sillaColor = getChairColor(
          silla,
          selectedSillaId,
          currentAsistenteId,
        );
        const selected = selectedSillaId === silla.id;

        return (
          <group
            key={silla.id}
            position={[slot.x, 0, slot.z]}
            rotation={[0, slot.rotation, 0]}
          >
            <mesh
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                handleChairSelection(silla.id, sillaOcupada, sillaEsDelAsistente);
              }}
              onClick={(event) => {
                event.stopPropagation();
                handleChairSelection(silla.id, sillaOcupada, sillaEsDelAsistente);
              }}
              castShadow
              position={[0, 0.18, 0]}
            >
              <boxGeometry args={[HIT_WIDTH, 0.4, HIT_DEPTH]} />
              <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
            </mesh>

            <ChairModel
              color={sillaColor}
              number={silla.numero}
              selected={selected}
            />
          </group>
        );
      })}
    </group>
  );
}
