const AUTHOR_SELECT = {
    id: true,
    login: true,
    full_name: true,
    avatar_path: true,
    rating: true
};

const PUBLIC_USER_SELECT = {
    id: true,
    login: true,
    full_name: true,
    avatar_path: true,
    rating: true,
    role: true,
    created_at: true
};

const PRIVATE_USER_SELECT = {
    ...PUBLIC_USER_SELECT,
    email: true,
    is_email_confirmed: true
};

const COMMUNITY_SUMMARY_SELECT = {
    id: true,
    title: true,
    avatar_path: true
};

module.exports = {
    AUTHOR_SELECT,
    PUBLIC_USER_SELECT,
    PRIVATE_USER_SELECT,
    COMMUNITY_SUMMARY_SELECT
};
