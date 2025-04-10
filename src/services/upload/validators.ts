import { FastifyRequest } from 'fastify';
import { createLogger } from '../../shared/utils/logger';
import { HttpError, UploadRequest } from '../../shared/types';
import { VIDEO } from '../../shared/config/environment';

const logger = createLogger('UploadValidators');

/**
 * Validate the upload request
 */
export const validateUploadRequest = async (request: FastifyRequest): Promise<UploadRequest> => {
  try {
    // Get multipart form data
    const data = await request.file();
    
    if (!data) {
      throw new HttpError('No file uploaded', 400);
    }
    
    // Check if file type is allowed
    if (!VIDEO.ALLOWED_TYPES.includes(data.mimetype)) {
      throw new HttpError(
        `Invalid file type: ${data.mimetype}. Allowed types: ${VIDEO.ALLOWED_TYPES.join(', ')}`,
        400
      );
    }
    
    // Check file size
    if (data.file.truncated) {
      throw new HttpError(`File too large. Maximum size: ${VIDEO.MAX_SIZE / 1024 / 1024}MB`, 400);
    }
    
    // Get form fields
    const fieldsPromises = [];
    for await (const field of data.fields) {
      fieldsPromises.push(field);
    }
    const fields = await Promise.all(fieldsPromises);
    
    // Extract name and voiceover text
    const nameField = fields.find((field) => field.fieldname === 'name');
    const voiceoverTextField = fields.find((field) => field.fieldname === 'voiceover_text');
    
    if (!nameField || !voiceoverTextField) {
      throw new HttpError('Missing required fields: name and voiceover_text', 400);
    }
    
    // Convert file to buffer
    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);
    
    // Construct validated request
    const uploadRequest: UploadRequest = {
      name: nameField.value as string,
      voiceover_text: voiceoverTextField.value as string,
      file: fileBuffer,
      filename: data.filename,
      mimetype: data.mimetype,
    };
    
    return uploadRequest;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    
    logger.error('Error validating upload request:', error);
    throw new HttpError('Invalid upload request', 400);
  }
};