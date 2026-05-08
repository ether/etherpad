'use strict';

const mammoth = require('mammoth');

export const docxBufferToHtml = async (buffer: Buffer): Promise<string> => {
  const result = await mammoth.convertToHtml(
    {buffer},
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const buf: Buffer = await image.read();
        const contentType = image.contentType || 'application/octet-stream';
        return {src: `data:${contentType};base64,${buf.toString('base64')}`};
      }),
    },
  );
  return result.value || '';
};
