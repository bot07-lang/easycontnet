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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { WorkflowService } from './workflow.service.js';

@Controller()
@UseGuards(AuthGuard)
export class WorkflowController {
  constructor(@Inject(WorkflowService) private readonly workflow: WorkflowService) {}

  /** The whole Workflow settings page for a project. Read follows project visibility. */
  @Get('projects/:projectId/workflow')
  getWorkflow(@CurrentUser() user: UserContext, @Param('projectId') projectId: string) {
    return this.workflow.getWorkflow(user, projectId);
  }

  /** Edit a status's configuration. manage_workflow in both code and RLS. */
  @Patch('workflow/statuses/:statusId')
  @RequirePermission('manage_workflow')
  updateStatus(
    @CurrentUser() user: UserContext,
    @Param('statusId') statusId: string,
    @Body()
    body: {
      name?: string;
      color?: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) {
    if (body?.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Status name cannot be blank');
    }
    if (body?.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
      throw new BadRequestException('Color must be a hex value like #6366F1');
    }
    if (body?.autoDueDays != null && (!Number.isInteger(body.autoDueDays) || body.autoDueDays <= 0)) {
      throw new BadRequestException('Auto due must be a positive whole number of days');
    }
    return this.workflow.updateStatus(user, statusId, body ?? {});
  }

  /** Create a status. manage_workflow. Always a middle status. */
  @Post('projects/:projectId/workflow/statuses')
  @RequirePermission('manage_workflow')
  createStatus(
    @CurrentUser() user: UserContext,
    @Param('projectId') projectId: string,
    @Body()
    body: {
      name?: string;
      color?: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Status name is required');
    const color = body?.color ?? '#9CA3AF';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new BadRequestException('Color must be a hex value like #6366F1');
    }
    if (body?.autoDueDays != null && (!Number.isInteger(body.autoDueDays) || body.autoDueDays <= 0)) {
      throw new BadRequestException('Auto due must be a positive whole number of days');
    }
    return this.workflow.createStatus(user, projectId, {
      name,
      color,
      autoDueDays: body?.autoDueDays ?? null,
      readOnly: body?.readOnly ?? false,
      reviewingRoleIds: body?.reviewingRoleIds ?? [],
    });
  }

  /** Delete a status. manage_workflow. Initial/terminal are pinned. */
  @Delete('workflow/statuses/:statusId')
  @RequirePermission('manage_workflow')
  deleteStatus(@CurrentUser() user: UserContext, @Param('statusId') statusId: string) {
    return this.workflow.deleteStatus(user, statusId);
  }

  /** Create a rating criterion. manage_workflow. */
  @Post('projects/:projectId/workflow/ratings')
  @RequirePermission('manage_workflow')
  createRating(
    @CurrentUser() user: UserContext,
    @Param('projectId') projectId: string,
    @Body() body: { name?: string; description?: string | null; statusId?: string },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Criteria name is required');
    if (!body?.statusId) throw new BadRequestException('A workflow status is required');
    return this.workflow.createRating(user, projectId, {
      name,
      description: body?.description?.trim() || null,
      statusId: body.statusId,
    });
  }

  /** Update a rating criterion. manage_workflow. */
  @Patch('workflow/ratings/:ratingId')
  @RequirePermission('manage_workflow')
  updateRating(
    @CurrentUser() user: UserContext,
    @Param('ratingId') ratingId: string,
    @Body() body: { name?: string; description?: string | null; statusId?: string },
  ) {
    if (body?.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Criteria name cannot be blank');
    }
    return this.workflow.updateRating(user, ratingId, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.description !== undefined ? { description: body.description?.trim() || null } : {}),
      ...(body?.statusId !== undefined ? { statusId: body.statusId } : {}),
    });
  }

  /** Delete a rating criterion. manage_workflow. */
  @Delete('workflow/ratings/:ratingId')
  @RequirePermission('manage_workflow')
  deleteRating(@CurrentUser() user: UserContext, @Param('ratingId') ratingId: string) {
    return this.workflow.deleteRating(user, ratingId);
  }

  /** Set a status's default assignees. manage_people_and_deadlines, not manage_workflow. */
  @Put('workflow/statuses/:statusId/default-assignees')
  @RequirePermission('manage_people_and_deadlines')
  setDefaultAssignees(
    @CurrentUser() user: UserContext,
    @Param('statusId') statusId: string,
    @Body() body: { profileIds?: string[] },
  ) {
    return this.workflow.setDefaultAssignees(user, statusId, body?.profileIds ?? []);
  }
}
