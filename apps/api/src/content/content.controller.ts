import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { ContentService } from './content.service.js';

@Controller('content')
@UseGuards(AuthGuard)
export class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  @Get('items')
  listItems(@CurrentUser() user: UserContext, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.content.listItems(user, projectId);
  }

  /** Templates in a project — populates the create-item picker. */
  @Get('templates')
  listTemplates(@CurrentUser() user: UserContext, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.content.listTemplates(user, projectId);
  }

  /** Create a content item. manage_content_items in both code and RLS. */
  @Post('items')
  @RequirePermission('manage_content_items')
  createItem(
    @CurrentUser() user: UserContext,
    @Body()
    body: {
      projectId?: string;
      name?: string;
      templateId?: string | null;
      description?: string | null;
      keywords?: string[];
    },
  ) {
    const projectId = body?.projectId;
    const name = body?.name?.trim();
    if (!projectId) throw new BadRequestException('projectId is required');
    if (!name) throw new BadRequestException('name is required');
    return this.content.createItem(
      user,
      projectId,
      name,
      body?.templateId ?? null,
      body?.description?.trim() || null,
      (body?.keywords ?? []).map((k) => k.trim()).filter(Boolean),
    );
  }

  @Get('items/:id')
  getItem(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.content.getItem(user, id);
  }

  // The field-save rule is "assigned to the current status OR holds
  // manage_content_items, and not read-only" — an assignment-or-permission
  // gate, which is exactly what RLS's app_can_edit_item enforces. A single
  // @RequirePermission here would wrongly block assigned writers, so this route
  // relies on RLS. @RequirePermission is for clean single-permission routes
  // (create project, manage templates, assign people) as they are built.
  @Put('items/:id/fields/:fieldId')
  saveField(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body() body: { value: unknown },
  ) {
    return this.content.saveFieldValue(user, id, fieldId, body?.value);
  }
}
