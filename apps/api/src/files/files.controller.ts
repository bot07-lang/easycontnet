import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FilesService } from './files.service.js';

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  /** A project's file library. */
  @Get()
  list(@CurrentUser() user: UserContext, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.files.listFiles(user, projectId);
  }

  /** Distinct folders — populates the "Assign a folder" dropdown. */
  @Get('folders')
  folders(@CurrentUser() user: UserContext, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.files.listFolders(user, projectId);
  }

  /** Step 1: issue a signed upload URL (browser PUTs bytes straight to Storage). */
  @Post('upload-url')
  uploadUrl(@CurrentUser() user: UserContext, @Body() body: { projectId?: string; name?: string }) {
    const projectId = body?.projectId;
    const name = body?.name?.trim();
    if (!projectId) throw new BadRequestException('projectId is required');
    if (!name) throw new BadRequestException('name is required');
    return this.files.createUploadUrl(user, projectId, name);
  }

  /** Step 2: record the metadata after the browser uploaded the bytes. */
  @Post()
  record(
    @CurrentUser() user: UserContext,
    @Body()
    body: { projectId?: string; path?: string; name?: string; mime?: string | null; size?: number | null; folder?: string | null },
  ) {
    const projectId = body?.projectId;
    const path = body?.path;
    const name = body?.name?.trim();
    if (!projectId || !path || !name) {
      throw new BadRequestException('projectId, path and name are required');
    }
    return this.files.recordFile(user, {
      projectId,
      path,
      name,
      mime: body?.mime ?? null,
      size: typeof body?.size === 'number' ? body.size : null,
      folder: body?.folder ?? null,
    });
  }

  /** Move a file to a folder (Library → file menu → Move). */
  @Patch(':id')
  update(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { folder?: string | null }) {
    return this.files.updateFile(user, id, body?.folder ?? null);
  }

  @Delete(':id')
  remove(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.files.deleteFile(user, id);
  }
}
