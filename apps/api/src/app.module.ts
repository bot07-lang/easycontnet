import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module.js';
import { AccessModule } from './access/access.module.js';
import { ContentModule } from './content/content.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';

@Module({
  imports: [DatabaseModule, AccessModule, ContentModule, ProjectsModule, DashboardModule],
})
export class AppModule {}
