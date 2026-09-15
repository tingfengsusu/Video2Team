/** 图片压缩：截图压到最大宽 1280，控制 LLM API 流量与存储体积。 */

export function shrinkImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      if (img.width <= maxW) return resolve(dataUrl);
      const scale = maxW / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = maxW;
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
