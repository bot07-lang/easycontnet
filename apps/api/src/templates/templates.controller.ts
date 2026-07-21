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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserContext } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../access/require-permission.decorator.js';
import { TemplatesService } from './templates.service.js';

@Controller()
@UseGuards(AuthGuard)
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  /** Templates grid for a project. Read follows project visibility. */
  @Get('projects/:projectId/templates')
  list(@CurrentUser() user: UserContext, @Param('projectId') projectId: string) {
    return this.templates.listTemplates(user, projectId);
  }

  /** A template's full tab/field structure, for the builder. */
  @Get('templates/:id')
  get(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.templates.getTemplate(user, id);
  }

  /** Create a template. manage_templates in both code and RLS. */
  @Post('projects/:projectId/templates')
  @RequirePermission('manage_templates')
  create(
    @CurrentUser() user: UserContext,
    @Param('projectId') projectId: string,
    @Body() body: { name?: string },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Template name is required');
    return this.templates.createTemplate(user, projectId, name);
  }

  /** Duplicate a template (tabs + fields). manage_templates. */
  @Post('templates/:id/duplicate')
  @RequirePermission('manage_templates')
  duplicate(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.templates.duplicateTemplate(user, id);
  }

  /** Clone a template into another project. manage_templates (+ target membership via RLS). */
  @Post('templates/:id/clone')
  @RequirePermission('manage_templates')
  clone(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { targetProjectId?: string },
  ) {
    if (!body?.targetProjectId) throw new BadRequestException('targetProjectId is required');
    return this.templates.cloneToProject(user, id, body.targetProjectId);
  }

  /** Rename / set-as-default. manage_templates. */
  @Patch('templates/:id')
  @RequirePermission('manage_templates')
  update(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { name?: string; isDefault?: boolean },
  ) {
    if (body?.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Template name cannot be blank');
    }
    return this.templates.updateTemplate(user, id, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    });
  }

  /** Delete a template. manage_templates. Blocked while items use it. */
  @Delete('templates/:id')
  @RequirePermission('manage_templates')
  remove(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.templates.deleteTemplate(user, id);
  }

  /* ---- fields ---- */

  @Post('template-tabs/:tabId/fields')
  @RequirePermission('manage_templates')
  createField(
    @CurrentUser() user: UserContext,
    @Param('tabId') tabId: string,
    @Body() body: { fieldType?: string },
  ) {
    if (!body?.fieldType) throw new BadRequestException('fieldType is required');
    return this.templates.createField(user, tabId, body.fieldType);
  }

  @Patch('template-fields/:id')
  @RequirePermission('manage_templates')
  updateField(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body()
    body: {
      label?: string;
      isVisible?: boolean;
      isRequired?: boolean;
      isPlainText?: boolean;
      recommendedLength?: number | null;
      recommendedLengthUnits?: string;
      guidelines?: string | null;
      choices?: string[];
      defaultContent?: string | null;
    },
  ) {
    return this.templates.updateField(user, id, body ?? {});
  }

  @Post('template-fields/:id/move')
  @RequirePermission('manage_templates')
  moveField(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { direction?: 'up' | 'down' },
  ) {
    if (body?.direction !== 'up' && body?.direction !== 'down') {
      throw new BadRequestException('direction must be up or down');
    }
    return this.templates.moveField(user, id, body.direction);
  }

  @Delete('template-fields/:id')
  @RequirePermission('manage_templates')
  deleteField(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.templates.deleteField(user, id);
  }

  /* ---- tabs ---- */

  @Post('templates/:id/tabs')
  @RequirePermission('manage_templates')
  createTab(
    @CurrentUser() user: UserContext,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('Tab name is required');
    return this.templates.createTab(user, id, name);
  }

  @Patch('template-tabs/:tabId')
  @RequirePermission('manage_templates')
  updateTab(
    @CurrentUser() user: UserContext,
    @Param('tabId') tabId: string,
    @Body() body: { name?: string; isHidden?: boolean },
  ) {
    if (body?.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Tab name cannot be blank');
    }
    return this.templates.updateTab(user, tabId, body ?? {});
  }

  @Delete('template-tabs/:tabId')
  @RequirePermission('manage_templates')
  deleteTab(@CurrentUser() user: UserContext, @Param('tabId') tabId: string) {
    return this.templates.deleteTab(user, tabId);
  }
}
