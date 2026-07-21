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

  /** Delete an item. manage_content_items in both code and RLS. */
  @Delete('items/:id')
  @RequirePermission('manage_content_items')
  deleteItem(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.content.deleteItem(user, id);
  }

  /** Rename an item. manage_content_items (code); RLS enforces membership. */
  @Patch('items/:id')
  @RequirePermission('manage_content_items')
  rename(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { name?: string }) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.content.renameItem(user, id, name);
  }

  /** Manual status change. manage_content_items (code); RLS enforces membership. */
  @Patch('items/:id/status')
  @RequirePermission('manage_content_items')
  changeStatus(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { statusId?: string },
  ) {
    if (!body?.statusId) throw new BadRequestException('statusId is required');
    return this.content.changeStatus(user, id, body.statusId);
  }

  /** Data for the assign-people panel: statuses (+reviewing roles +assignees) and members. */
  @Get('items/:id/assignment')
  getAssignment(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.content.getAssignmentInfo(user, id);
  }

  /** Set the item's assignees for one status. manage_people_and_deadlines (code + RLS). */
  @Put('items/:id/statuses/:statusId/assignees')
  @RequirePermission('manage_people_and_deadlines')
  setAssignees(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Param('statusId') statusId: string,
    @Body() body: { profileIds?: string[] },
  ) {
    return this.content.setStatusAssignees(user, id, statusId, body?.profileIds ?? []);
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
