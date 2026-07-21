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

// Merged deployment: when SERVE_WEB=true, this process also serves the built
// React SPA (apps/web/dist), so one service hosts both. Left off in local dev,
// where Vite serves the frontend on its own port. The path resolves the same
// from src (dev) and dist (prod) — both sit one level under apps/api.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const staticImports =
  process.env.SERVE_WEB === 'true'
    ? [
        ServeStaticModule.forRoot({
          rootPath: webDist,
          // Never let the SPA fallback swallow API routes.
          exclude: ['/api/{*path}'],
        }),
      ]
    : [];

@Module({
  imports: [
    ...staticImports,
    DatabaseModule, AccessModule, ContentModule, ProjectsModule,
    DashboardModule, WorkflowModule, TemplatesModule,
  ],
})
export class AppModule {}
