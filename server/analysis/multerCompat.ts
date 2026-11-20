import type { Request, Response, NextFunction } from 'express';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      file?: UploadedFile;
    }
  }
}

export function multerCompat(opts: { limits?: { fileSize?: number } } = {}) {
  const maxBytes = opts.limits?.fileSize ?? 50 * 1024 * 1024;

  return {
    single: (fieldName: string) => {
      return (req: Request, res: Response, next: NextFunction) => {
        if (req.file) return next();

        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return next();
        }

        const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!match) return next();
        const boundaryStr = match[1] || match[2];
        const boundary = Buffer.from(`--${boundaryStr}`);

        const chunks: Buffer[] = [];
        let total = 0;

        req.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error('LIMIT_FILE_SIZE'));
            return;
          }
          chunks.push(chunk);
        });

        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks);
            let start = 0;
            while (start < body.length) {
              const boundaryIdx = body.indexOf(boundary, start);
              if (boundaryIdx === -1) break;

              const partStart = boundaryIdx + boundary.length;
              const nextBoundaryIdx = body.indexOf(boundary, partStart);
              if (nextBoundaryIdx === -1) break;

              const part = body.subarray(partStart, nextBoundaryIdx);
              start = nextBoundaryIdx;

              const headerEnd = part.indexOf('\r\n\r\n');
              if (headerEnd === -1) continue;

              const headerStr = part.subarray(0, headerEnd).toString('utf-8');
              if (headerStr.includes(`name="${fieldName}"`)) {
                const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
                const originalname = filenameMatch ? filenameMatch[1] : 'sample.bin';
                // Data starts after \r\n\r\n and ends 2 bytes before the next boundary (\r\n)
                const dataStart = headerEnd + 4;
                const dataEnd = part.length - 2;
                if (dataEnd >= dataStart) {
                  const fileBuffer = part.subarray(dataStart, dataEnd);
                  req.file = {
                    buffer: Buffer.from(fileBuffer),
                    originalname,
                    size: fileBuffer.length,
                  };
                  break;
                }
              }
            }
            next();
          } catch (e) {
            next(e);
          }
        });

        req.on('error', (err) => {
          if (err.message === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ status: 'FAILED', detail: 'File too large' });
          } else {
            next(err);
          }
        });
      };
    },
  };
}
