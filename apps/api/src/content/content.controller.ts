import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
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
