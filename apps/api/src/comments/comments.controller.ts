import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CommentsService, type NewComment } from './comments.service.js';

/**
 * Comments API. No blanket @RequirePermission — viewing/adding comments is open
 * to project members (view access), and RLS enforces the fine-grained rules
 * (own vs manage_comments), same as the field-save route.
 */
@Controller()
@UseGuards(AuthGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get('content/items/:id/comments')
  list(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.comments.list(user, id);
  }

  @Post('content/items/:id/comments')
  add(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: NewComment) {
    return this.comments.add(user, id, body ?? {});
  }

  @Patch('comments/:id')
  edit(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { body?: string }) {
    return this.comments.edit(user, id, body?.body ?? '');
  }

  @Delete('comments/:id')
  remove(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.comments.remove(user, id);
  }

  @Post('comments/:id/resolve')
  resolve(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { resolved?: boolean }) {
    return this.comments.setResolved(user, id, body?.resolved ?? true);
  }
}
