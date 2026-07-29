import { Module } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { ServeStaticModule } from '@nestjs/serve-static';
import { DatabaseModule } from './db/database.module.js';
import { AccessModule } from './access/access.module.js';
import { ContentModule } from './content/content.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { FilesModule } from './files/files.module.js';
import { RolesModule } from './roles/roles.module.js';
import { CommentsModule } from './comments/comments.module.js';

// Merged deployment: when SERVE_WEB=true, this process also serves the built
// React SPA (apps/web/dist), so one service hosts both. Left off in local dev,
// where Vite serves the frontend on its own port. The path resolves the same
// from src (dev) and dist (prod) — both sit one level under apps/api.
// import.meta.url is only evaluated when actually serving static (Railway/merged),
// never in the Vercel serverless bundle where SERVE_WEB is unset.
const staticImports =
  process.env.SERVE_WEB === 'true'
    ? [
        ServeStaticModule.forRoot({
          rootPath: fileURLToPath(new URL('../../web/dist', import.meta.url)),
          // Never let the SPA fallback swallow API routes.
          exclude: ['/api/{*path}'],
        }),
      ]
    : [];

@Module({
  imports: [
    ...staticImports,
    DatabaseModule, AccessModule, ContentModule, ProjectsModule,
    DashboardModule, WorkflowModule, TemplatesModule, FilesModule, RolesModule, CommentsModule,
  ],
})
export class AppModule {}
