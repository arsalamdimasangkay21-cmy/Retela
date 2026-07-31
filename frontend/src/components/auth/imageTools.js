export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

export async function compressImage(file, maxWidth = 1280, quality = 0.82) {
  const image = await fileToImage(file);
  const scale = Math.min(1, maxWidth / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      resolve(compressed);
    }, "image/jpeg", quality);
  });
}

export function dataUrlToFile(dataUrl, filename) {
  const [meta, value] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], filename, { type: mime });
}

export function captureVideoFrame(video, filename) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return dataUrlToFile(canvas.toDataURL("image/jpeg", 0.9), filename);
}

export async function imageBlurScore(file) {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  let edges = 0;
  let total = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = (y * size + x) * 4;
      const left = (y * size + x - 1) * 4;
      const right = (y * size + x + 1) * 4;
      const top = ((y - 1) * size + x) * 4;
      const bottom = ((y + 1) * size + x) * 4;
      const gray = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const laplace = Math.abs(
        ((data[left] + data[left + 1] + data[left + 2]) / 3)
        + ((data[right] + data[right + 1] + data[right + 2]) / 3)
        + ((data[top] + data[top + 1] + data[top + 2]) / 3)
        + ((data[bottom] + data[bottom + 1] + data[bottom + 2]) / 3)
        - (4 * gray)
      );
      edges += laplace;
      total += 1;
    }
  }
  return edges / Math.max(total, 1);
}
