/**
 * 团队模块 — 空间切换、团队 CRUD、成员管理
 */
const TeamManager = (() => {
  let currentSpace = null;
  let teams = [];
  let shelves = [];

  // 初始化：从本地 DB 读取当前空间
  async function init() {
    const spaces = await DB.getSpaces();
    // 默认选中个人空间
    const savedSpaceId = localStorage.getItem('currentSpaceId') || 'personal';
    const found = spaces.find(s => s.id === savedSpaceId);
    currentSpace = found || spaces[0];
    if (currentSpace) {
      localStorage.setItem('currentSpaceId', currentSpace.id);
    }
    shelves = await DB.getShelvesBySpace(currentSpace.id);
  }

  function getCurrentSpace() { return currentSpace; }
  function getTeams() { return teams; }
  function getShelves() { return shelves; }

  function getCurrentSpaceType() {
    return currentSpace ? currentSpace.type : 'personal';
  }

  function isTeamSpace() {
    return currentSpace && currentSpace.type === 'team';
  }

  async function switchSpace(spaceId) {
    const spaces = await DB.getSpaces();
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    currentSpace = space;
    localStorage.setItem('currentSpaceId', space.id);
    shelves = await DB.getShelvesBySpace(space.id);
  }

  async function reloadShelves() {
    if (!currentSpace) return;
    shelves = await DB.getShelvesBySpace(currentSpace.id);
  }

  // ---- 团队 CRUD ----

  async function loadTeams() {
    if (!Auth.isLoggedIn()) {
      teams = [];
      return;
    }
    try {
      const res = await API.get('/api/teams');
      teams = res.data || [];
      // 同步团队到本地 spaces
      for (const t of teams) {
        await DB.createSpace(`team_${t.id}`, t.name, 'team', t.id);
      }
    } catch (e) {
      console.warn('[Team] 加载团队列表失败:', e.message);
    }
  }

  async function createTeam(name, description) {
    if (!Auth.isLoggedIn()) throw new Error('请先登录');
    const res = await API.post('/api/teams', { name, description });
    const team = res.data;
    await DB.createSpace(`team_${team.id}`, team.name, 'team', team.id);
    await loadTeams();
    return team;
  }

  async function joinTeam(inviteCode) {
    if (!Auth.isLoggedIn()) throw new Error('请先登录');
    // 需要知道 team id，先用邀请码查询
    // 通过 GET /api/teams 获取所有团队，然后逐一尝试 join
    // 实际由 UI 层在 join modal 中手动输入 team id + invite code
    // 这里提供通用的 join 方法
    return { success: false };
  }

  async function joinTeamById(teamId, inviteCode) {
    if (!Auth.isLoggedIn()) throw new Error('请先登录');
    const res = await API.post(`/api/teams/${teamId}/join`, { inviteCode });
    const team = await API.get(`/api/teams/${teamId}`);
    await DB.createSpace(`team_${teamId}`, team.data.name, 'team', teamId);
    await loadTeams();
    return res;
  }

  async function leaveTeam(teamId) {
    await API.post(`/api/teams/${teamId}/leave`);
    await loadTeams();
    // 如果当前空间是这个团队，切回个人空间
    if (currentSpace && currentSpace.id === `team_${teamId}`) {
      await switchSpace('personal');
    }
  }

  async function deleteTeam(teamId) {
    await API.del(`/api/teams/${teamId}`);
    await loadTeams();
    if (currentSpace && currentSpace.id === `team_${teamId}`) {
      await switchSpace('personal');
    }
  }

  async function getMembers(teamId) {
    const res = await API.get(`/api/teams/${teamId}/members`);
    return res.data;
  }

  async function updateMemberRole(teamId, userId, role) {
    await API.put(`/api/teams/${teamId}/members/${userId}`, { role });
  }

  async function removeMember(teamId, userId) {
    await API.del(`/api/teams/${teamId}/members/${userId}`);
  }

  async function regenerateInvite(teamId) {
    const res = await API.post(`/api/teams/${teamId}/regenerate-invite`);
    return res.data.invite_code;
  }

  // ---- 货架 CRUD（通过 API 或本地 DB） ----

  async function createShelf(name) {
    if (!currentSpace) throw new Error('未选择空间');

    if (isTeamSpace() && Auth.isLoggedIn()) {
      const res = await API.post(`/api/teams/${currentSpace.server_id}/shelves`, { name });
      const shelf = res.data;
      await DB.createShelf(shelf.name, currentSpace.id);
      await reloadShelves();
      return shelf;
    } else {
      const id = await DB.createShelf(name, currentSpace.id);
      await reloadShelves();
      return { id, name, team_id: null };
    }
  }

  async function renameShelf(shelfId, name) {
    if (isTeamSpace() && Auth.isLoggedIn() && currentSpace.server_id) {
      await API.put(`/api/teams/${currentSpace.server_id}/shelves/${shelfId}`, { name });
    }
    await DB.updateShelf(shelfId, name);
    await reloadShelves();
  }

  async function deleteShelf(shelfId) {
    if (isTeamSpace() && Auth.isLoggedIn() && currentSpace.server_id) {
      await API.del(`/api/teams/${currentSpace.server_id}/shelves/${shelfId}`);
    }
    await DB.deleteShelf(shelfId);
    await reloadShelves();
  }

  return {
    init, getCurrentSpace, getTeams, getShelves, getCurrentSpaceType, isTeamSpace,
    switchSpace, reloadShelves,
    loadTeams, createTeam, joinTeam, joinTeamById, leaveTeam, deleteTeam,
    getMembers, updateMemberRole, removeMember, regenerateInvite,
    createShelf, renameShelf, deleteShelf,
  };
})();
