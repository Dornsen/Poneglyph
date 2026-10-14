const { requirePositiveInteger } = require('../utils/parse');

function createUserController(userService) {
    return {
        getAllUsersAsync: async (req, res) => {
            const result = await userService.listAsync(req.query, req.user);
            return res.status(200).json(result);
        },

        getUserByIdAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const user = await userService.getByIdAsync(user_id, req.user);
            return res.status(200).json(user);
        },

        createUserAsync: async (req, res) => {
            const user = await userService.createAsync(req.body);
            return res.status(201).json(user);
        },

        uploadAvatarAsync: async (req, res) => {
            const result = await userService.uploadAvatarAsync(req.user.id, req.file);
            return res.status(200).json(result);
        },

        updateUserDataAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const user = await userService.updateAsync(req.user, user_id, req.body);
            return res.status(200).json(user);
        },

        deleteUserAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const result = await userService.deleteAsync(req.user, user_id);
            return res.status(200).json(result);
        },

        getUserCommunitiesAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const result = await userService.listCommunitiesAsync(user_id, req.query);
            return res.status(200).json(result);
        }
    };
}

module.exports = createUserController;
