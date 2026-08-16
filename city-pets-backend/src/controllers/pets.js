/* =========================================================
   CITY PETS — Controladores de mascotas
   El propietario de una mascota siempre sale de req.user.id.
   Nunca se acepta userId del cuerpo de la petición.
   ========================================================= */

const prisma = require('../db');

/* Número a Float, o NaN si no es numérico. */
function toFloat(v) {
  if (v === undefined || v === null || v === '') return NaN;
  return parseFloat(v);
}

async function listPets(req, res) {
  const pets = await prisma.pet.findMany({ where: { userId: req.user.id } });
  res.json(pets);
}

async function getPet(req, res) {
  const pet = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!pet) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }
  res.json(pet);
}

async function createPet(req, res) {
  const { name, species, breed, age, ration, weight } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  if (!species || typeof species !== 'string' || !species.trim()) {
    return res.status(400).json({ error: 'La especie es obligatoria' });
  }
  const ageNum = toFloat(age);
  if (isNaN(ageNum)) {
    return res.status(400).json({ error: 'La edad debe ser un número' });
  }
  const rationNum = toFloat(ration);
  const weightNum = toFloat(weight);

  const pet = await prisma.pet.create({
    data: {
      name: name.trim(),
      species: species.trim(),
      breed: typeof breed === 'string' ? breed : '',
      age: ageNum,
      ration: isNaN(rationNum) ? 0 : rationNum,
      weight: isNaN(weightNum) ? null : weightNum,
      userId: req.user.id
    }
  });

  res.status(201).json(pet);
}

async function updatePet(req, res) {
  const existing = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!existing) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }

  const { name, species, breed, age, ration, weight } = req.body;
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'El nombre no es válido' });
    }
    data.name = name.trim();
  }
  if (species !== undefined) {
    if (typeof species !== 'string' || !species.trim()) {
      return res.status(400).json({ error: 'La especie no es válida' });
    }
    data.species = species.trim();
  }
  if (breed !== undefined) data.breed = typeof breed === 'string' ? breed : '';
  if (age !== undefined) {
    const ageNum = toFloat(age);
    if (isNaN(ageNum)) {
      return res.status(400).json({ error: 'La edad debe ser un número' });
    }
    data.age = ageNum;
  }
  if (ration !== undefined) {
    const rationNum = toFloat(ration);
    if (isNaN(rationNum)) {
      return res.status(400).json({ error: 'La ración debe ser un número' });
    }
    data.ration = rationNum;
  }
  if (weight !== undefined) {
    const weightNum = toFloat(weight);
    data.weight = isNaN(weightNum) ? null : weightNum;
  }

  const pet = await prisma.pet.update({ where: { id: existing.id }, data });
  res.json(pet);
}

async function deletePet(req, res) {
  const existing = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!existing) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }

  await prisma.pet.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}

module.exports = { listPets, getPet, createPet, updatePet, deletePet };