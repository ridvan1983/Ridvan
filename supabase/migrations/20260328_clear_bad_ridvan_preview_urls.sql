update public.projects
set preview_url = null,
    vercel_project_id = null,
    vercel_project_name = null
where preview_url like '%ridvan.app%';
