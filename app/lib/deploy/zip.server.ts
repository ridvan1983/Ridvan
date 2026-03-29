type ZipEntry = {
  path: string;
  data: Uint8Array;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosDate, dosTime };
}

function concatArrays(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

export function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosDate, dosTime } = toDosDateTime(now);
  const localFileRecords: Uint8Array[] = [];
  const centralDirectoryRecords: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path);
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + pathBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.byteLength);
    writeUint32(localView, 22, data.byteLength);
    writeUint16(localView, 26, pathBytes.byteLength);
    writeUint16(localView, 28, 0);
    localHeader.set(pathBytes, 30);

    localFileRecords.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + pathBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.byteLength);
    writeUint32(centralView, 24, data.byteLength);
    writeUint16(centralView, 28, pathBytes.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(pathBytes, 46);
    centralDirectoryRecords.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectory = concatArrays(centralDirectoryRecords);
  const localFiles = concatArrays(localFileRecords);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.byteLength);
  writeUint32(endView, 16, localFiles.byteLength);
  writeUint16(endView, 20, 0);

  return concatArrays([localFiles, centralDirectory, endRecord]);
}
