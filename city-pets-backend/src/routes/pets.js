/* =========================================================
   CITY PETS — Rutas de mascotas
   Todas las rutas requieren autenticación (JWT).
   ========================================================= */

const express = require('express');
const { listPets, getPet, createPet, updatePet, deletePet } = require('../controllers/pets');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired);

router.get('/', listPets);
router.post('/', createPet);
router.get('/:id', getPet);
router.put('/:id', updatePet);
router.delete('/:id', deletePet);

module.exports = router;