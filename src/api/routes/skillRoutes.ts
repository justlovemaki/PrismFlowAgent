import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import YAML from 'yaml';
import { parseGithubUrl } from '../../utils/helpers.js';
import { syncSkillsFromFilesystem } from '../../services/agents/SkillSyncService.js';
import { LogService } from '../../services/LogService.js';

export async function registerSkillRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/skills', async () => {
    return await store.listSkills();
  });

  fastify.post('/api/skills/scan', async (request, reply) => {
    try {
      const result = await syncSkillsFromFilesystem(store, context.skillService);
      return { status: 'success', ...result };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/store/search', async (request, reply) => {
    try {
      const { q, page, limit, sortBy } = request.query as any;
      return await context.skillStoreService.searchSkills(q, page, limit, sortBy);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/store/ai-search', async (request, reply) => {
    try {
      const { q } = request.query as any;
      return await context.skillStoreService.aiSearchSkills(q);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills/import/github', async (request, reply) => {
    try {
      const { githubUrl } = request.body as any;
      if (!githubUrl) {
        return reply.status(400).send({ error: '缺少 githubUrl 参数' });
      }

      const params = parseGithubUrl(githubUrl);
      if (!params) {
        return reply.status(400).send({ error: '无效的 GitHub URL' });
      }

      // 尝试获取 GitHub Token
      const githubToken = context.settings.GLOBAL_GITHUB_TOKEN || (context.publisherInstances.find(p => p.id === 'github') as any)?.config?.token;

      // 使用直接从 GitHub API 获取内容的方法
      const response = await context.skillStoreService.fetchGithubSkillContentsDirectly(params, githubToken);
      const files = response.files;

      if (!files || !Array.isArray(files) || files.length === 0) {
        return reply.status(400).send({ error: '在指定的 GitHub 路径中未找到文件' });
      }

      // 查找 SKILL.md 以获取元数据
      const skillMdFile = files.find(f => f.path === 'SKILL.md');
      if (!skillMdFile) {
        return reply.status(400).send({ error: '在指定的 GitHub 路径中未找到 SKILL.md' });
      }

      // 解析 SKILL.md 元数据
      const skillMdContent = skillMdFile.content
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
      
      let metadata: any = {};
      let instructions = '';
      if (frontmatterMatch) {
        try {
          metadata = YAML.parse(frontmatterMatch[1]);
          instructions = frontmatterMatch[2].trim();
        } catch (e) {
          LogService.error(`Failed to parse SKILL.md frontmatter: ${e}`);
        }
      }

      const skillId = metadata.name || params.path.split('/').pop() || 'imported-skill';
      const skillsDir = store.getSkillsDir();
      const skillDir = path.join(skillsDir, skillId);

      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 保存所有文件
      for (const file of files) {
        const filePath = path.join(skillDir, file.path);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, 'utf8');
      }

      const skill = {
        id: skillId,
        name: metadata.name || skillId,
        description: metadata.description || '',
        instructions: instructions || skillMdContent,
        files: files.map(f => f.path).filter(p => p !== 'SKILL.md'),
        dirPath: skillDir,
      };

      await store.saveSkill(skill);
      await context.skillService.refreshSkills();

      return { status: 'success', skill };
    } catch (error: any) {
      LogService.error(`GitHub skill import failed: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills', async (request, reply) => {

    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: '请上传 .zip 压缩包' });
      }

      const buffer = await data.toBuffer();
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      // 查找 SKILL.md（支持根目录或一级子目录）
      let skillMdEntry = entries.find(e => e.entryName === 'SKILL.md');
      if (!skillMdEntry) {
        skillMdEntry = entries.find(e => e.entryName.endsWith('/SKILL.md') && e.entryName.split('/').length === 2);
      }
      if (!skillMdEntry) {
        return reply.status(400).send({ error: '压缩包中未找到 SKILL.md 文件' });
      }

      // 解析 YAML frontmatter（规范化换行符和 BOM）
      const skillMdContent = skillMdEntry.getData().toString('utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
      if (!frontmatterMatch) {
        return reply.status(400).send({ error: 'SKILL.md 缺少 YAML frontmatter（需要 --- 包裹的元数据）' });
      }

      let metadata: any;
      try {
        metadata = YAML.parse(frontmatterMatch[1]);
      } catch (yamlErr: any) {
        return reply.status(400).send({ error: `SKILL.md frontmatter YAML 格式错误: ${yamlErr.message}` });
      }

      if (!metadata.name) {
        return reply.status(400).send({ error: 'SKILL.md frontmatter 缺少 name 字段' });
      }
      if (!metadata.description) {
        return reply.status(400).send({ error: 'SKILL.md frontmatter 缺少 description 字段' });
      }

      // name 校验: 最多64字符，仅小写字母、数字、连字符
      if (metadata.name.length > 64 || !/^[a-z0-9-]+$/.test(metadata.name)) {
        return reply.status(400).send({ error: 'name 仅允许小写字母、数字和连字符，最多64字符' });
      }

      const instructions = frontmatterMatch[2].trim();
      const skillId = metadata.name;
      const skillsDir = store.getSkillsDir();
      const skillDir = path.join(skillsDir, skillId);

      // 清理旧目录（如果存在）
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      fs.mkdirSync(skillDir, { recursive: true });

      // 解压所有文件到技能目录
      const prefix = skillMdEntry.entryName === 'SKILL.md' ? '' : skillMdEntry.entryName.replace('SKILL.md', '');
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const relativePath = prefix ? entry.entryName.replace(prefix, '') : entry.entryName;
        const targetPath = path.join(skillDir, relativePath);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
        if (relativePath !== 'SKILL.md') {
          files.push(relativePath);
        }
      }

      const skill = {
        id: skillId,
        name: metadata.name,
        description: metadata.description,
        instructions,
        files,
        dirPath: skillDir,
      };

      await store.saveSkill(skill);
      await context.skillService.refreshSkills();
      return { status: 'success', skill };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const skill = await store.getSkill(id);
      
      if (skill && skill.isBuiltin) {
        return reply.status(403).send({ error: '系统内置技能不可删除' });
      }

      // 仅当目录在 data/skills 下时才物理删除文件夹
      const skillsDir = store.getSkillsDir();
      const skillDir = (skill && skill.dirPath) || path.join(skillsDir, id);
      
      if (fs.existsSync(skillDir) && skillDir.startsWith(skillsDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      
      await store.deleteSkill(id);
      await context.skillService.refreshSkills();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // 解析技能目录的辅助函数：优先使用数据库路径，路径不存在时回退到 SkillService 的路径
  const resolveSkillDir = (skill: any): string => {
    // 1. 数据库中的路径存在，直接使用
    if (skill.dirPath && fs.existsSync(skill.dirPath)) {
      return skill.dirPath;
    }
    // 2. 回退到 SkillService 中扫描到的路径（解决 Docker ↔ 本地环境切换问题）
    const fsSkill = context.skillService.getSkill(skill.id);
    if (fsSkill?.dirPath && fs.existsSync(fsSkill.dirPath)) {
      return fsSkill.dirPath;
    }
    // 3. 最后回退到 data/skills 下的默认路径
    return skill.dirPath || path.join(store.getSkillsDir(), skill.id);
  };

  fastify.get('/api/skills/:id/files', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      
      if (!fs.existsSync(skillDir)) {
        return { files: [] };
      }
      const walkDir = (dir: string, prefix = ''): any[] => {
        const items: any[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            items.push({ name: entry.name, path: rel, type: 'dir', children: walkDir(path.join(dir, entry.name), rel) });
          } else {
            const stat = fs.statSync(path.join(dir, entry.name));
            items.push({ name: entry.name, path: rel, type: 'file', size: stat.size });
          }
        }
        return items;
      };
      return { files: walkDir(skillDir) };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/:id/file/*', async (request, reply) => {
    try {
      const { id, '*': filePath } = request.params as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      const fullPath = path.join(skillDir, filePath);
      
      // 防止路径穿越
      if (!fullPath.startsWith(skillDir)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return reply.status(404).send({ error: '文件不存在' });
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return { content, path: filePath };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills/:id/file/*', async (request, reply) => {
    try {
      const { id, '*': filePath } = request.params as any;
      const { content } = request.body as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      const fullPath = path.join(skillDir, filePath);
      
      // 防止路径穿越
      if (!fullPath.startsWith(skillDir)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // 确保目录存在
      const targetDir = path.dirname(fullPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');

      let needsDbSave = false;

      // 如果是新文件，更新技能的文件列表
      if (!skill.files) skill.files = [];
      if (filePath !== 'SKILL.md' && !skill.files.includes(filePath)) {
        skill.files.push(filePath);
        needsDbSave = true;
      }

      // 如果修改的是 SKILL.md，同步更新数据库元数据
      if (filePath === 'SKILL.md') {
        const skillMdContent = content
          .replace(/^\uFEFF/, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');
        const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
        if (frontmatterMatch) {
          try {
            const metadata = YAML.parse(frontmatterMatch[1]);
            const instructions = frontmatterMatch[2].trim();
            
            // 只要有任何一项更新，就同步到数据库
            if (metadata.name) {
              skill.name = metadata.name;
              needsDbSave = true;
            }
            if (metadata.description) {
              skill.description = metadata.description;
              needsDbSave = true;
            }
            if (instructions !== undefined) {
              skill.instructions = instructions;
              needsDbSave = true;
            }
          } catch (e: any) {
            // YAML 解析失败也允许保存文件，但不更新元数据
            LogService.warn(`Failed to parse SKILL.md YAML: ${e.message}`);
          }
        }
      }

      if (needsDbSave) {
        await store.saveSkill(skill);
      }
      
      // 无论是否更新数据库，都刷新内存缓存，因为文件已经在磁盘上更新了
      await context.skillService.refreshSkills();

      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
