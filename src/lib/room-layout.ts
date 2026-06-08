export const ROOM_LAYOUT_WIDTH = 4200;
export const ROOM_LAYOUT_HEIGHT = 3000;
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

export type SceneFrame = {
  minX: number;
  minY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type PlanFrame = SceneFrame;

export type TableDimensions = {
  width: number;
  height: number;
  chairOffset: number;
};

export type EventTitleFootprint = {
  text: string;
  width: number;
  height: number;
  safeWidth: number;
  safeHeight: number;
  maxWidthRatio: number;
  worldFontSize: number;
  planFontSize: number;
};

export type ProtectedTitleRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProtectedBounds = EventBounds;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

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
    ...distributeAlongHorizontal(topCount, width, -(height / 2 + offset), 0),
    ...distributeAlongVertical(
      rightCount,
      height,
      width / 2 + offset,
      -Math.PI / 2,
    ),
    ...distributeAlongHorizontal(
      bottomCount,
      width,
      height / 2 + offset,
      Math.PI,
      true,
    ),
    ...distributeAlongVertical(
      leftCount,
      height,
      -(width / 2 + offset),
      Math.PI / 2,
      true,
    ),
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
  reverse = false,
) {
  if (count <= 0) {
    return [] as ChairSlot[];
  }

  const spacing = width / (count + 1);

  const slots = Array.from({ length: count }, (_, index) => ({
    x: -width / 2 + spacing * (index + 1),
    y,
    rotation,
  }));

  return reverse ? slots.reverse() : slots;
}

function distributeAlongVertical(
  count: number,
  height: number,
  x: number,
  rotation: number,
  reverse = false,
) {
  if (count <= 0) {
    return [] as ChairSlot[];
  }

  const spacing = height / (count + 1);

  const slots = Array.from({ length: count }, (_, index) => ({
    x,
    y: -height / 2 + spacing * (index + 1),
    rotation,
  }));

  return reverse ? slots.reverse() : slots;
}

export function getEventTitleFootprint(
  eventName: string,
  roomWidth: number = ROOM_LAYOUT_WIDTH,
  roomHeight: number = ROOM_LAYOUT_HEIGHT,
): EventTitleFootprint {
  const text = eventName.trim() || "EVENTO";
  const normalizedLength = clamp(text.length, 6, 48);
  const lineEstimate = Math.max(1, Math.ceil(normalizedLength / 18));
  const width = clamp(
    420 + normalizedLength * 18,
    Math.min(520, roomWidth * 0.22),
    roomWidth * 0.56,
  );
  const height = clamp(
    120 + lineEstimate * 34,
    Math.min(150, roomHeight * 0.08),
    roomHeight * 0.22,
  );
  const safeWidth = clamp(width + 110, width + 50, roomWidth * 0.5);
  const safeHeight = clamp(height + 96, height + 42, roomHeight * 0.18);
  const maxWidthRatio = clamp(safeWidth / roomWidth + 0.06, 0.24, 0.72);

  return {
    text,
    width,
    height,
    safeWidth,
    safeHeight,
    maxWidthRatio,
    worldFontSize: clamp(width / 720, 0.56, 1.05),
    planFontSize: clamp(width / 11.5, 28, 56),
  };
}

export function getProtectedTitleRect(
  eventName: string,
  roomWidth: number = ROOM_LAYOUT_WIDTH,
  roomHeight: number = ROOM_LAYOUT_HEIGHT,
): ProtectedTitleRect {
  const footprint = getEventTitleFootprint(eventName, roomWidth, roomHeight);

  return {
    x: roomWidth / 2 - footprint.safeWidth / 2,
    y: roomHeight / 2 - footprint.safeHeight / 2,
    width: footprint.safeWidth,
    height: footprint.safeHeight,
  };
}

export function getProtectedEventBounds(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
  eventName: string,
  roomWidth: number = ROOM_LAYOUT_WIDTH,
  roomHeight: number = ROOM_LAYOUT_HEIGHT,
): ProtectedBounds {
  const bounds = getEventBounds(mesas);
  const footprint = getEventTitleFootprint(eventName, roomWidth, roomHeight);
  const titleMinX = roomWidth / 2 - footprint.safeWidth / 2;
  const titleMaxX = roomWidth / 2 + footprint.safeWidth / 2;
  const titleMinY = roomHeight / 2 - footprint.safeHeight / 2;
  const titleMaxY = roomHeight / 2 + footprint.safeHeight / 2;
  const minX = Math.min(bounds.minX, titleMinX);
  const maxX = Math.max(bounds.maxX, titleMaxX);
  const minY = Math.min(bounds.minY, titleMinY);
  const maxY = Math.max(bounds.maxY, titleMaxY);

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

export function doRectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

export function getTableRect(
  posX: number,
  posY: number,
  chairCount: number,
  margin: number = 0,
) {
  const dimensions = getTableDimensions(chairCount);

  return {
    x: posX - dimensions.width / 2 - margin,
    y: posY - dimensions.height / 2 - margin,
    width: dimensions.width + margin * 2,
    height: dimensions.height + margin * 2,
  };
}

export function doesTableOverlapProtectedTitle(
  posX: number,
  posY: number,
  chairCount: number,
  eventName: string,
  margin: number = 24,
) {
  return doRectanglesOverlap(
    getTableRect(posX, posY, chairCount, margin),
    getProtectedTitleRect(eventName),
  );
}

export function getTableDimensions(chairCount: number): TableDimensions {
  if (chairCount <= 8) {
    return {
      width: 196,
      height: 108,
      chairOffset: 34,
    };
  }

  if (chairCount <= 10) {
    return {
      width: 236,
      height: 116,
      chairOffset: 36,
    };
  }

  if (chairCount <= 12) {
    return {
      width: 278,
      height: 126,
      chairOffset: 38,
    };
  }

  return {
    width: 278 + (chairCount - 12) * 20,
    height: 132 + Math.ceil((chairCount - 12) / 2) * 10,
    chairOffset: 40,
  };
}

export function getNextMesaPosition(
  existingTables: number,
  chairCount: number = 8,
  eventName: string = "EVENTO",
) {
  const gapX = 520;
  const gapY = 330;
  const centerX = ROOM_LAYOUT_WIDTH / 2;
  const centerY = ROOM_LAYOUT_HEIGHT / 2;
  const columnOffsets = [0, 1, -1, 2, -2, 3, -3];
  const rowOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  const dimensions = getTableDimensions(chairCount);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidateIndex = existingTables + attempt;
    const columnIndex = candidateIndex % columnOffsets.length;
    const rowIndex = Math.floor(candidateIndex / columnOffsets.length);
    const safeRowOffset =
      rowOffsets[Math.min(rowIndex, rowOffsets.length - 1)] ??
      rowIndex - rowOffsets.length + 5;
    const posX = clamp(
      centerX + columnOffsets[columnIndex] * gapX,
      dimensions.width / 2 + 60,
      ROOM_LAYOUT_WIDTH - dimensions.width / 2 - 60,
    );
    const posY = clamp(
      centerY + safeRowOffset * gapY,
      dimensions.height / 2 + 60,
      ROOM_LAYOUT_HEIGHT - dimensions.height / 2 - 60,
    );

    if (!doesTableOverlapProtectedTitle(posX, posY, chairCount, eventName)) {
      return { posX, posY };
    }
  }

  return {
    posX: clamp(
      centerX + gapX,
      dimensions.width / 2 + 60,
      ROOM_LAYOUT_WIDTH - dimensions.width / 2 - 60,
    ),
    posY: clamp(
      centerY,
      dimensions.height / 2 + 60,
      ROOM_LAYOUT_HEIGHT - dimensions.height / 2 - 60,
    ),
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

export function getSceneFrame(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
): SceneFrame {
  const bounds = getEventBounds(mesas);
  const basePaddingX = 240;
  const basePaddingTop = 210;
  const basePaddingBottom = 180;
  const contentWidth = Math.max(bounds.width + basePaddingX * 2, 1200);
  const contentHeight = Math.max(bounds.height + basePaddingTop + basePaddingBottom, 900);
  const minX = bounds.centerX - contentWidth / 2;
  const minY = bounds.centerY - contentHeight / 2;

  return {
    minX,
    minY,
    width: contentWidth,
    height: contentHeight,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  };
}

export function getPlanFrame(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
): PlanFrame {
  const bounds = getEventBounds(mesas);
  const horizontalPadding = 150;
  const topPadding = 190;
  const bottomPadding = 120;
  const minWidth = 900;
  const minHeight = 700;
  const rawMinX = Math.max(0, bounds.minX - horizontalPadding);
  const rawMinY = Math.max(0, bounds.minY - topPadding);
  const rawMaxX = Math.min(ROOM_LAYOUT_WIDTH, bounds.maxX + horizontalPadding);
  const rawMaxY = Math.min(ROOM_LAYOUT_HEIGHT, bounds.maxY + bottomPadding);
  const contentWidth = Math.max(rawMaxX - rawMinX, minWidth);
  const contentHeight = Math.max(rawMaxY - rawMinY, minHeight);
  const minX = clamp(
    rawMinX - Math.max(0, minWidth - (rawMaxX - rawMinX)) / 2,
    0,
    Math.max(0, ROOM_LAYOUT_WIDTH - contentWidth),
  );
  const minY = clamp(
    rawMinY - Math.max(0, minHeight - (rawMaxY - rawMinY)) / 2,
    0,
    Math.max(0, ROOM_LAYOUT_HEIGHT - contentHeight),
  );

  return {
    minX,
    minY,
    width: contentWidth,
    height: contentHeight,
    centerX: minX + contentWidth / 2,
    centerY: minY + contentHeight / 2,
  };
}

export function getCenteredPlanFrame(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
): PlanFrame {
  const bounds = getEventBounds(mesas);
  const horizontalPadding = 150;
  const topPadding = 190;
  const bottomPadding = 120;
  const minWidth = 900;
  const minHeight = 700;
  const roomCenterX = ROOM_LAYOUT_WIDTH / 2;
  const roomCenterY = ROOM_LAYOUT_HEIGHT / 2;
  const halfWidth = Math.min(
    ROOM_LAYOUT_WIDTH / 2,
    Math.max(
      minWidth / 2,
      roomCenterX - bounds.minX + horizontalPadding,
      bounds.maxX - roomCenterX + horizontalPadding,
    ),
  );
  const halfHeight = Math.min(
    ROOM_LAYOUT_HEIGHT / 2,
    Math.max(
      minHeight / 2,
      roomCenterY - bounds.minY + topPadding,
      bounds.maxY - roomCenterY + bottomPadding,
    ),
  );

  return {
    minX: roomCenterX - halfWidth,
    minY: roomCenterY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
    centerX: roomCenterX,
    centerY: roomCenterY,
  };
}

export function getProtectedCenteredPlanFrame(
  mesas: Array<{ pos_x: number; pos_y: number; sillas: Array<unknown> }>,
  eventName: string,
): PlanFrame {
  const bounds = getProtectedEventBounds(mesas, eventName);
  const horizontalPadding = 150;
  const topPadding = 140;
  const bottomPadding = 120;
  const minWidth = 900;
  const minHeight = 700;
  const roomCenterX = ROOM_LAYOUT_WIDTH / 2;
  const roomCenterY = ROOM_LAYOUT_HEIGHT / 2;
  const halfWidth = Math.min(
    ROOM_LAYOUT_WIDTH / 2,
    Math.max(
      minWidth / 2,
      roomCenterX - bounds.minX + horizontalPadding,
      bounds.maxX - roomCenterX + horizontalPadding,
    ),
  );
  const halfHeight = Math.min(
    ROOM_LAYOUT_HEIGHT / 2,
    Math.max(
      minHeight / 2,
      roomCenterY - bounds.minY + topPadding,
      bounds.maxY - roomCenterY + bottomPadding,
    ),
  );

  return {
    minX: roomCenterX - halfWidth,
    minY: roomCenterY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
    centerX: roomCenterX,
    centerY: roomCenterY,
  };
}
