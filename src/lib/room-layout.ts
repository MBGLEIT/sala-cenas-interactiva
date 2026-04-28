export const ROOM_LAYOUT_WIDTH = 2200;
export const ROOM_LAYOUT_HEIGHT = 1600;
export const ROOM_WORLD_SCALE = 0.015;

export const TABLE_PLAN_WIDTH = 180;
export const TABLE_PLAN_HEIGHT = 100;
export const TABLE_PLAN_CHAIR_OFFSET = 44;

export type ChairSlot = {
  x: number;
  y: number;
  rotation: number;
};

export type EventBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type TableDimensions = {
  width: number;
  height: number;
  chairOffset: number;
};

function mapPerimeterPoint(
  distance: number,
  width: number,
  height: number,
  offset: number,
): ChairSlot {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const topLength = width;
  const rightLength = height;
  const bottomLength = width;
  const perimeter = 2 * (width + height);
  const normalizedDistance = ((distance % perimeter) + perimeter) % perimeter;

  if (normalizedDistance < topLength) {
    return {
      x: -halfWidth + normalizedDistance,
      y: -(halfHeight + offset),
      rotation: -Math.PI / 2,
    };
  }

  if (normalizedDistance < topLength + rightLength) {
    return {
      x: halfWidth + offset,
      y: -halfHeight + (normalizedDistance - topLength),
      rotation: 0,
    };
  }

  if (normalizedDistance < topLength + rightLength + bottomLength) {
    return {
      x: halfWidth - (normalizedDistance - topLength - rightLength),
      y: halfHeight + offset,
      rotation: Math.PI / 2,
    };
  }

  return {
    x: -(halfWidth + offset),
    y:
      halfHeight -
      (normalizedDistance - topLength - rightLength - bottomLength),
    rotation: Math.PI,
  };
}

export function getRectangleChairSlots(
  chairCount: number,
  width: number = TABLE_PLAN_WIDTH,
  height: number = TABLE_PLAN_HEIGHT,
  offset: number = TABLE_PLAN_CHAIR_OFFSET,
) {
  if (chairCount <= 0) {
    return [] as ChairSlot[];
  }

  const estimatedLongCount = Math.round(
    chairCount * (width / (width + height)),
  );
  let longCount = clampToEven(estimatedLongCount, chairCount);
  let shortCount = chairCount - longCount;

  if (shortCount < 0) {
    shortCount = 0;
    longCount = chairCount;
  }

  const topCount = Math.ceil(longCount / 2);
  const bottomCount = Math.floor(longCount / 2);
  const rightCount = Math.ceil(shortCount / 2);
  const leftCount = Math.floor(shortCount / 2);

  return [
    ...distributeAlongHorizontal(topCount, width, -(height / 2 + offset), -Math.PI / 2),
    ...distributeAlongVertical(rightCount, height, width / 2 + offset, 0),
    ...distributeAlongHorizontal(bottomCount, width, height / 2 + offset, Math.PI / 2),
    ...distributeAlongVertical(leftCount, height, -(width / 2 + offset), Math.PI),
  ];
}

function clampToEven(value: number, total: number) {
  if (total <= 1) {
    return total;
  }

  let nextValue = Math.max(2, Math.min(total, value));

  if (nextValue % 2 !== total % 2) {
    nextValue += nextValue < total ? 1 : -1;
  }

  return Math.max(0, Math.min(total, nextValue));
}

function distributeAlongHorizontal(
  count: number,
  width: number,
  y: number,
  rotation: number,
) {
  if (count <= 0) {
    return [] as ChairSlot[];
  }

  const spacing = width / (count + 1);

  return Array.from({ length: count }, (_, index) => ({
    x: -width / 2 + spacing * (index + 1),
    y,
    rotation,
  }));
}

function distributeAlongVertical(
  count: number,
  height: number,
  x: number,
  rotation: number,
) {
  if (count <= 0) {
    return [] as ChairSlot[];
  }

  const spacing = height / (count + 1);

  return Array.from({ length: count }, (_, index) => ({
    x,
    y: -height / 2 + spacing * (index + 1),
    rotation,
  }));
}

export function getTableDimensions(chairCount: number): TableDimensions {
  if (chairCount <= 8) {
    return {
      width: 180,
      height: 100,
      chairOffset: 44,
    };
  }

  if (chairCount <= 10) {
    return {
      width: 220,
      height: 108,
      chairOffset: 48,
    };
  }

  if (chairCount <= 12) {
    return {
      width: 258,
      height: 118,
      chairOffset: 52,
    };
  }

  return {
    width: 258 + (chairCount - 12) * 16,
    height: 126 + Math.ceil((chairCount - 12) / 2) * 8,
    chairOffset: 56,
  };
}

export function getNextMesaPosition(existingTables: number) {
  const columns = 5;
  const startX = 260;
  const startY = 240;
  const gapX = 380;
  const gapY = 230;
  const col = existingTables % columns;
  const row = Math.floor(existingTables / columns);

  return {
    posX: startX + col * gapX,
    posY: startY + row * gapY,
  };
}

export function roomPointToWorld(posX: number, posY: number) {
  return {
    x: (posX - ROOM_LAYOUT_WIDTH / 2) * ROOM_WORLD_SCALE,
    z: (posY - ROOM_LAYOUT_HEIGHT / 2) * ROOM_WORLD_SCALE,
  };
}

export function getEventBounds(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
): EventBounds {
  if (mesas.length === 0) {
    return {
      minX: ROOM_LAYOUT_WIDTH / 2,
      maxX: ROOM_LAYOUT_WIDTH / 2,
      minY: ROOM_LAYOUT_HEIGHT / 2,
      maxY: ROOM_LAYOUT_HEIGHT / 2,
      width: 0,
      height: 0,
      centerX: ROOM_LAYOUT_WIDTH / 2,
      centerY: ROOM_LAYOUT_HEIGHT / 2,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const mesa of mesas) {
    const dimensions = getTableDimensions(mesa.sillas.length);
    minX = Math.min(minX, mesa.pos_x - dimensions.width / 2);
    maxX = Math.max(maxX, mesa.pos_x + dimensions.width / 2);
    minY = Math.min(minY, mesa.pos_y - dimensions.height / 2);
    maxY = Math.max(maxY, mesa.pos_y + dimensions.height / 2);

    const chairSlots = getRectangleChairSlots(
      mesa.sillas.length,
      dimensions.width,
      dimensions.height,
      dimensions.chairOffset,
    );
    for (const slot of chairSlots) {
      minX = Math.min(minX, mesa.pos_x + slot.x - 28);
      maxX = Math.max(maxX, mesa.pos_x + slot.x + 28);
      minY = Math.min(minY, mesa.pos_y + slot.y - 24);
      maxY = Math.max(maxY, mesa.pos_y + slot.y + 24);
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}
