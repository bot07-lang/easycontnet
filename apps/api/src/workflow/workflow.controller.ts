import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
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
